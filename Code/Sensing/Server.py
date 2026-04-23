#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import time
import threading
import subprocess
import datetime
import signal
import re
import asyncio
from pathlib import Path

import requests
from flask import Flask, send_file, jsonify, request
from flask_cors import CORS

from gpiozero import MotionSensor, OutputDevice
import smbus2 as smbus

# UART
import serial

try:
    from supabase import create_client as supabase_create_client
    SUPABASE_PY_AVAILABLE = True
except Exception:
    supabase_create_client = None
    SUPABASE_PY_AVAILABLE = False


# ==================== CONFIG (HARDWARE) ====================
# GPIOs (BCM numbering)
PIR_PORCH_PIN = 24       # GPIO24 (pin 18)
PIR_FOYER_PIN = 25       # GPIO25 (pin 22)

LIGHT_PORCH_PIN = 5      # GPIO5  (pin 29)
LIGHT_FOYER_PIN = 6      # GPIO6  (pin 31)

# I2C / BH1750
I2C_BUS_ID = 1
BH1750_ADDR_OUTDOOR = 0x23   # porch BH1750
BH1750_ADDR_INDOOR  = 0x5C   # foyer BH1750

# Defaults (API can change these at runtime)
DEFAULT_OUTDOOR_DARK_LX = 50.0
DEFAULT_INDOOR_DIM_LX   = 50.0
DEFAULT_PORCH_HOLD_SEC  = 30.0
DEFAULT_FOYER_HOLD_SEC  = 20.0

DEFAULT_LOOP_DT = 0.3

DEFAULT_RECORD_ENABLED = True
DEFAULT_RECORD_DURATION_SEC = 5
DEFAULT_PORCH_RECORD_COOLDOWN_SEC = 20

# ==================== UART CONFIG ====================
DEFAULT_UART_PORT = os.environ.get("UART_PORT", "/dev/serial0")
DEFAULT_UART_BAUD = int(os.environ.get("UART_BAUD", "115200"))
DEFAULT_UART_ENABLED = (os.environ.get("UART_ENABLED", "1") == "1")


# ==================== PATHS ====================
BASE_DIR = Path(__file__).resolve().parent
CAPTURE_DIR = BASE_DIR / "captures"
CAPTURE_DIR.mkdir(exist_ok=True)


# ==================== BH1750 CLASS ====================
class BH1750:
    CONT_HIGH_RES_MODE = 0x10

    def __init__(self, bus, addr, name="BH1750"):
        self.bus = bus
        self.addr = addr
        self.name = name
        self.last_lux = 0.0
        self.valid = False

    def read_lux(self):
        try:
            self.bus.write_byte(self.addr, BH1750.CONT_HIGH_RES_MODE)
            time.sleep(0.18)
            data = self.bus.read_i2c_block_data(self.addr, BH1750.CONT_HIGH_RES_MODE, 2)
            raw = (data[0] << 8) | data[1]
            lux = raw / 1.2
            self.last_lux = lux
            self.valid = True
            return lux
        except Exception as e:
            print(f"[WARN] {self.name} read failed: {e}")
            self.valid = False
            return self.last_lux


# ==================== RECORDING HELPERS ====================
def _run_video_cmd(extra_args, timeout_sec):
    """
    Try rpicam-vid first (new name), then libcamera-vid (old name).
    On Pi 4 we use --codec libav to get a proper MP4 container.
    """
    for binary in ("rpicam-vid", "libcamera-vid"):
        try:
            cmd = [binary] + extra_args
            print(f"[REC] Running: {' '.join(cmd)}")
            subprocess.run(cmd, check=True, timeout=timeout_sec)
            return True
        except FileNotFoundError:
            print(f"[REC] {binary} not found, trying fallback...")
            continue
        except subprocess.TimeoutExpired:
            print(f"[REC] {binary} timed out")
            return False
        except subprocess.CalledProcessError as e:
            print(f"[REC] {binary} error: {e}")
            return False

    print("[REC] ERROR: Neither rpicam-vid nor libcamera-vid found!")
    return False


# ==================== UART PARSER ====================
def parse_tracker_line(line: str):
    """
    Accepts either:
      1) DATA,BAT=12.41,PCT=68,LUX=532.0,LIM=0,1,STATE=0
      2) LDR L=1246 | R=1298 | Δ=-52 | LIM_LEFT=0 | LIM_RIGHT=0 | Batt=11.50 V | BattPct=0% | Lux=890.8

    Returns dict or None.
    """
    s = (line or "").strip()
    if not s:
        return None

    # ---------- Preferred DATA format ----------
    if s.startswith("DATA,"):
        out = {}
        try:
            parts = s.split(",")

            for i in range(1, len(parts)):
                p = parts[i].strip()

                if p.startswith("BAT="):
                    out["battery_v"] = float(p.split("=", 1)[1])

                elif p.startswith("PCT="):
                    out["battery_pct"] = int(float(p.split("=", 1)[1]))

                elif p.startswith("LUX="):
                    out["lux"] = float(p.split("=", 1)[1])

                elif p.startswith("STATE="):
                    out["state"] = int(p.split("=", 1)[1])

                elif p.startswith("LIM="):
                    left_str = p.split("=", 1)[1]
                    right_str = None
                    if i + 1 < len(parts) and parts[i + 1].strip().isdigit():
                        right_str = parts[i + 1].strip()
                    else:
                        if "," in left_str:
                            left_str, right_str = left_str.split(",", 1)

                    out["lim_left"] = int(left_str)
                    if right_str is not None:
                        out["lim_right"] = int(right_str)

            return out if out else None
        except Exception:
            return None

    # ---------- Human-readable debug format fallback ----------
    try:
        out = {}

        m = re.search(r'Batt=([0-9]+(?:\.[0-9]+)?)\s*V', s, re.IGNORECASE)
        if m:
            out["battery_v"] = float(m.group(1))

        m = re.search(r'BattPct=([0-9]+(?:\.[0-9]+)?)\s*%', s, re.IGNORECASE)
        if m:
            out["battery_pct"] = int(float(m.group(1)))

        m = re.search(r'Lux=([0-9]+(?:\.[0-9]+)?)', s, re.IGNORECASE)
        if m:
            out["lux"] = float(m.group(1))

        return out if out else None
    except Exception:
        return None


# ==================== CONTROLLER ====================
class SolarisController:
    """
    Runs the control logic in a background thread and exposes state via Flask.
    Also reads tracker data from UART in a separate thread.
    """

    def __init__(self):
        # Runtime config (mutable via API)
        self.outdoor_dark_lx = DEFAULT_OUTDOOR_DARK_LX
        self.indoor_dim_lx = DEFAULT_INDOOR_DIM_LX
        self.porch_hold_sec = DEFAULT_PORCH_HOLD_SEC
        self.foyer_hold_sec = DEFAULT_FOYER_HOLD_SEC
        self.loop_dt = DEFAULT_LOOP_DT

        self.record_enabled = DEFAULT_RECORD_ENABLED
        self.record_duration_sec = DEFAULT_RECORD_DURATION_SEC
        self.porch_record_cooldown_sec = DEFAULT_PORCH_RECORD_COOLDOWN_SEC

        # Modes
        self.mode = "automatic"
        self.manual_porch = False
        self.manual_foyer = False

        # State
        self.last_motion_porch = 0.0
        self.last_motion_foyer = 0.0
        self.last_record_porch = 0.0  # only updated when recording actually starts

        self.lux_porch = 0.0
        self.lux_foyer = 0.0
        self.motion_porch = False
        self.motion_foyer = False

        # previous motion state for rising-edge logging
        self.prev_motion_porch = False
        self.prev_motion_foyer = False

        self.light_porch_state = False
        self.light_foyer_state = False

        self.bh_porch_valid = False
        self.bh_foyer_valid = False

        # UART state
        self.uart_enabled = DEFAULT_UART_ENABLED
        self.uart_port = DEFAULT_UART_PORT
        self.uart_baud = DEFAULT_UART_BAUD

        self.tracker_battery_v = None
        self.tracker_battery_pct = None
        self.tracker_lux = None
        self.tracker_lim_left = None
        self.tracker_lim_right = None
        self.tracker_motor_state = None
        self.tracker_last_rx_ts = None
        self.tracker_last_line = ""

        self._uart_thread = None
        self._uart_serial = None

        # Simple throttle for DB logging
        self._last_battery_log_ts = 0.0
        self._last_lux_log_ts = 0.0
        self._uart_log_interval_sec = 30.0

        # Thread control
        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread = None

        # Hardware objects
        self.bus = None
        self.pir_porch = None
        self.pir_foyer = None
        self.bh_porch = None
        self.bh_foyer = None
        self.light_porch = None
        self.light_foyer = None

        # Supabase config
        self.supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.supabase_key = os.environ.get("SUPABASE_KEY", "")
        self.pi_id = os.environ.get("SOLARIS_PI_ID", "").strip()
        self.user_id = (
            os.environ.get("SOLARIS_USER_ID", "").strip()
            or os.environ.get("SUPABASE_USER_ID", "").strip()
            or os.environ.get("USER_ID", "").strip()
        )

        # Cached schedule window
        self._sched_last_fetch_ts = 0.0
        self._sched_poll_fallback_interval_sec = float(os.environ.get("SCHEDULE_FALLBACK_POLL_SEC", "300"))
        self._sched_start_time = None
        self._sched_end_time = None
        self._sched_days_of_week = []
        self._sched_last_fetch_ok = False

        # Cached user preferences
        self._pref_last_fetch_ts = 0.0
        self._pref_poll_fallback_interval_sec = float(os.environ.get("PREFERENCES_FALLBACK_POLL_SEC", "300"))
        self._pref_last_fetch_ok = False
        self.pref_light_on_duration = None
        self.pref_video_clip_duration = None
        self.pref_motion_sensitivity = None
        self.pref_auto_delete_after_days = None
        self.pref_notifications_enabled = None
        self.pref_night_mode_enabled = None
        self.pref_created_at = None
        self.pref_updated_at = None

        # Supabase Realtime schedule subscription
        self._sched_realtime_enabled = (os.environ.get("SCHEDULE_REALTIME_ENABLED", "1") == "1")
        self._sched_realtime_connected = False
        self._sched_realtime_last_event_ts = None
        self._sched_realtime_error = ""
        self._sched_rt_thread = None
        self._sched_rt_loop = None
        self._sched_rt_client = None
        self._sched_rt_channel = None

        # Supabase Realtime user preferences subscription
        self._pref_realtime_enabled = (os.environ.get("PREFERENCES_REALTIME_ENABLED", "1") == "1")
        self._pref_realtime_connected = False
        self._pref_realtime_last_event_ts = None
        self._pref_realtime_error = ""
        self._pref_rt_thread = None
        self._pref_rt_loop = None
        self._pref_rt_client = None
        self._pref_rt_channel = None

    def start(self):
        self.bus = smbus.SMBus(I2C_BUS_ID)

        self.pir_porch = MotionSensor(PIR_PORCH_PIN)
        self.pir_foyer = MotionSensor(PIR_FOYER_PIN)

        self.bh_porch = BH1750(self.bus, BH1750_ADDR_OUTDOOR, name="Porch BH1750")
        self.bh_foyer = BH1750(self.bus, BH1750_ADDR_INDOOR, name="Foyer BH1750")

        self.light_porch = OutputDevice(LIGHT_PORCH_PIN, active_high=True, initial_value=False)
        self.light_foyer = OutputDevice(LIGHT_FOYER_PIN, active_high=True, initial_value=False)

        self._stop_event.clear()

        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

        if self.uart_enabled:
            self._uart_thread = threading.Thread(target=self._uart_loop, daemon=True)
            self._uart_thread.start()

        self._refresh_schedule_now(reason="startup")
        self._refresh_preferences_now(reason="startup")
        if self._sched_realtime_enabled:
            self._sched_rt_thread = threading.Thread(target=self._run_schedule_realtime_thread, daemon=True)
            self._sched_rt_thread.start()
        if self._pref_realtime_enabled:
            self._pref_rt_thread = threading.Thread(target=self._run_preferences_realtime_thread, daemon=True)
            self._pref_rt_thread.start()

        print("[CTRL] Controller started.")
        print(f"[CTRL] Captures dir: {CAPTURE_DIR}")

    def stop(self):
        print("[CTRL] Stopping controller...")
        self._stop_event.set()

        if self._thread:
            self._thread.join(timeout=2.0)
        if self._uart_thread:
            self._uart_thread.join(timeout=2.0)
        if self._sched_rt_thread:
            self._sched_rt_thread.join(timeout=2.0)
        if self._pref_rt_thread:
            self._pref_rt_thread.join(timeout=2.0)

        try:
            if self._sched_rt_loop and self._sched_rt_loop.is_running():
                self._sched_rt_loop.call_soon_threadsafe(lambda: None)
        except Exception:
            pass

        try:
            if self._pref_rt_loop and self._pref_rt_loop.is_running():
                self._pref_rt_loop.call_soon_threadsafe(lambda: None)
        except Exception:
            pass

        try:
            if self._uart_serial:
                self._uart_serial.close()
        except Exception:
            pass

        try:
            if self.light_porch:
                self.light_porch.off()
            if self.light_foyer:
                self.light_foyer.off()
        except Exception:
            pass

        try:
            if self.bus:
                self.bus.close()
        except Exception:
            pass

        print("[CTRL] Controller stopped cleanly.")

    def _set_lights(self, porch_on: bool, foyer_on: bool):
        try:
            if porch_on:
                self.light_porch.on()
            else:
                self.light_porch.off()

            if foyer_on:
                self.light_foyer.on()
            else:
                self.light_foyer.off()
        except Exception as e:
            print(f"[WARN] Light control error: {e}")

        self.light_porch_state = bool(porch_on)
        self.light_foyer_state = bool(foyer_on)

    # -------------------- SUPABASE EVENT LOGGING --------------------
    def log_trigger_event(self, sensor_name: str):
        if not self.supabase_url or not self.supabase_key or not self.pi_id:
            print("[DB] Missing SUPABASE_URL, SUPABASE_KEY, or SOLARIS_PI_ID")
            return False

        url = f"{self.supabase_url}/rest/v1/trigger_events"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        payload = {
            "pi_id": self.pi_id,
            "sensor_triggered": sensor_name,
        }

        try:
            r = requests.post(url, headers=headers, json=payload, timeout=3.5)
            r.raise_for_status()
            print(f"[DB] Logged trigger event: {sensor_name}")
            return True
        except Exception as e:
            print(f"[DB] Failed to log trigger event ({sensor_name}): {e}")
            return False

    def log_battery_value(self, percentage_value: int):
        if not self.supabase_url or not self.supabase_key or not self.pi_id:
            print("[DB] Missing SUPABASE_URL, SUPABASE_KEY, or SOLARIS_PI_ID")
            return False

        url = f"{self.supabase_url}/rest/v1/battery_logs"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        payload = {
            "percentage": int(percentage_value),
            "device_id": self.pi_id,
            "time": datetime.datetime.now().isoformat(),
        }

        try:
            r = requests.post(url, headers=headers, json=payload, timeout=3.5)
            r.raise_for_status()
            print(f"[DB] Logged battery: {percentage_value}%")
            return True
        except Exception as e:
            print(f"[DB] Failed to log battery: {e}")
            return False

    def log_lux_value(self, lux_value: int):
        if not self.supabase_url or not self.supabase_key or not self.pi_id:
            print("[DB] Missing SUPABASE_URL, SUPABASE_KEY, or SOLARIS_PI_ID")
            return False

        url = f"{self.supabase_url}/rest/v1/lux_logs"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        payload = {
            "value": int(lux_value),
            "device_id": self.pi_id,
            "time": datetime.datetime.now().isoformat(),
        }

        try:
            r = requests.post(url, headers=headers, json=payload, timeout=3.5)
            r.raise_for_status()
            print(f"[DB] Logged lux: {lux_value}")
            return True
        except Exception as e:
            print(f"[DB] Failed to log lux: {e}")
            return False

    # -------------------- UART LOOP --------------------
    def _uart_open(self):
        try:
            ser = serial.Serial(
                port=self.uart_port,
                baudrate=self.uart_baud,
                timeout=1.0,
            )
            ser.reset_input_buffer()
            print(f"[UART] Opened {self.uart_port} @ {self.uart_baud}")
            return ser
        except Exception as e:
            print(f"[UART] Open failed ({self.uart_port}): {e}")
            return None

    def _uart_loop(self):
        print("[UART] UART loop started.")
        backoff = 1.0

        while not self._stop_event.is_set():
            if self._uart_serial is None:
                self._uart_serial = self._uart_open()
                if self._uart_serial is None:
                    time.sleep(backoff)
                    backoff = min(backoff * 1.5, 10.0)
                    continue
                backoff = 1.0

            try:
                raw = self._uart_serial.readline()
                if not raw:
                    continue

                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                parsed = parse_tracker_line(line)

                with self._lock:
                    self.tracker_last_line = line

                if parsed is None:
                    continue

                with self._lock:
                    self.tracker_last_rx_ts = time.time()

                    if "battery_v" in parsed:
                        self.tracker_battery_v = parsed["battery_v"]
                    if "battery_pct" in parsed:
                        self.tracker_battery_pct = parsed["battery_pct"]
                    if "lux" in parsed:
                        self.tracker_lux = parsed["lux"]
                    if "lim_left" in parsed:
                        self.tracker_lim_left = parsed["lim_left"]
                    if "lim_right" in parsed:
                        self.tracker_lim_right = parsed["lim_right"]
                    if "state" in parsed:
                        self.tracker_motor_state = parsed["state"]

                    now = time.time()
                    if self.tracker_battery_pct is not None and (now - self._last_battery_log_ts) >= self._uart_log_interval_sec:
                        if self.log_battery_value(self.tracker_battery_pct):
                            self._last_battery_log_ts = now

                    if self.tracker_lux is not None and (now - self._last_lux_log_ts) >= self._uart_log_interval_sec:
                        if self.log_lux_value(int(self.tracker_lux)):
                            self._last_lux_log_ts = now

            except Exception as e:
                print(f"[UART] Read error: {e}")
                try:
                    if self._uart_serial:
                        self._uart_serial.close()
                except Exception:
                    pass
                self._uart_serial = None
                time.sleep(1.0)

        print("[UART] UART loop exiting.")

    # -------------------- RECORDING --------------------
    def trigger_porch_recording_async(self):
        with self._lock:
            if not self.record_enabled:
                return False, "recording disabled"

            now = time.time()
            if (now - self.last_record_porch) <= self.porch_record_cooldown_sec:
                return False, "cooldown active"

            self.last_record_porch = now
            self.log_trigger_event("camera")
            dur = int(self.record_duration_sec)

        def _record():
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            outfile = CAPTURE_DIR / f"porch_{ts}.mp4"
            print(f"[REC] Starting porch recording -> {outfile}")

            ok = _run_video_cmd([
                "-t", f"{dur}s",
                "--codec", "libav",
                "--width", "1920",
                "--height", "1080",
                "--framerate", "15",
                "--bitrate", "6000000",
                "--denoise", "cdn_hq",
                "-o", str(outfile),
                "--nopreview",
            ], timeout_sec=dur + 8)

            if ok and outfile.exists():
                try:
                    st = outfile.stat()
                    print(f"[REC] Saved OK ({st.st_size} bytes) -> {outfile}")
                except Exception:
                    print(f"[REC] Saved OK -> {outfile}")
            else:
                print(f"[REC] Finished attempt (FAIL) -> {outfile}")

        threading.Thread(target=_record, daemon=True).start()
        return True, "recording started"

    def _loop(self):
        print("Starting Solaris controller loop (AUTOMATIC/MANUAL/SCHEDULED) ...")
        while not self._stop_event.is_set():
            now = time.time()

            # Read PIR
            try:
                motion_porch = bool(self.pir_porch.is_active)
                motion_foyer = bool(self.pir_foyer.is_active)
            except Exception as e:
                print(f"[WARN] PIR read error: {e}")
                motion_porch = False
                motion_foyer = False

            # Log only on rising edge
            if motion_porch and not self.prev_motion_porch:
                self.log_trigger_event("outdoor_pir")

            if motion_foyer and not self.prev_motion_foyer:
                self.log_trigger_event("indoor_pir")

            # Read BH1750
            lux_porch = self.bh_porch.read_lux()
            lux_foyer = self.bh_foyer.read_lux()

            with self._lock:
                self.motion_porch = motion_porch
                self.motion_foyer = motion_foyer
                self.lux_porch = float(lux_porch)
                self.lux_foyer = float(lux_foyer)
                self.bh_porch_valid = bool(self.bh_porch.valid)
                self.bh_foyer_valid = bool(self.bh_foyer.valid)

                if motion_porch:
                    self.last_motion_porch = now
                if motion_foyer:
                    self.last_motion_foyer = now

                mode = self.mode

                if mode == "scheduled":
                    in_window = self._scheduled_window_allows_operation(now)
                    if not in_window:
                        porch_on = False
                        foyer_on = False
                    else:
                        porch_recent_motion = (now - self.last_motion_porch) < self.porch_hold_sec
                        porch_dark_enough = self.lux_porch < self.outdoor_dark_lx
                        porch_on = bool(porch_recent_motion and porch_dark_enough)

                        foyer_recent_motion = (now - self.last_motion_foyer) < self.foyer_hold_sec
                        foyer_dark_enough = self.lux_foyer < self.indoor_dim_lx
                        foyer_on = bool(foyer_recent_motion and foyer_dark_enough)

                        if (
                            self.record_enabled
                            and motion_porch
                            and porch_dark_enough
                            and (now - self.last_record_porch) > self.porch_record_cooldown_sec
                        ):
                            print("[REC] Triggering porch recording due to motion + dark (scheduled window)...")
                            self.trigger_porch_recording_async()

                elif mode == "manual":
                    porch_on = bool(self.manual_porch)
                    foyer_on = bool(self.manual_foyer)

                else:
                    porch_recent_motion = (now - self.last_motion_porch) < self.porch_hold_sec
                    porch_dark_enough = self.lux_porch < self.outdoor_dark_lx
                    porch_on = bool(porch_recent_motion and porch_dark_enough)

                    foyer_recent_motion = (now - self.last_motion_foyer) < self.foyer_hold_sec
                    foyer_dark_enough = self.lux_foyer < self.indoor_dim_lx
                    foyer_on = bool(foyer_recent_motion and foyer_dark_enough)

                    if (
                        self.record_enabled
                        and motion_porch
                        and porch_dark_enough
                        and (now - self.last_record_porch) > self.porch_record_cooldown_sec
                    ):
                        print("[REC] Triggering porch recording due to motion + dark...")
                        self.trigger_porch_recording_async()

                self._set_lights(porch_on, foyer_on)

                print(
                    f"[MODE={self.mode}] "
                    f"[PORCH] Lux:{self.lux_porch:6.1f} (valid={self.bh_porch_valid}) "
                    f"| Motion:{self.motion_porch} | Light:{'ON ' if self.light_porch_state else 'OFF'}  ||  "
                    f"[FOYER] Lux:{self.lux_foyer:6.1f} (valid={self.bh_foyer_valid}) "
                    f"| Motion:{self.motion_foyer} | Light:{'ON ' if self.light_foyer_state else 'OFF'}"
                )

                dt = float(self.loop_dt)

            self.prev_motion_porch = motion_porch
            self.prev_motion_foyer = motion_foyer

            time.sleep(dt)

        with self._lock:
            self._set_lights(False, False)

        # -------------------- SCHEDULE REFRESH HELPERS --------------------
    def _refresh_schedule_now(self, reason: str = "manual"):
        self._sched_last_fetch_ts = time.time()
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[SCHED] Fetching schedule now | reason={reason} | ts={ts}")
        ok = self._fetch_schedule_window()
        print(f"[SCHED] Refresh reason={reason} ok={ok}")
        return ok

    def _refresh_preferences_now(self, reason: str = "manual"):
        self._pref_last_fetch_ts = time.time()
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[PREF] Fetching user preferences now | reason={reason} | ts={ts}")
        ok = self._fetch_user_preferences()
        print(f"[PREF] Refresh reason={reason} ok={ok}")
        return ok

    def _run_schedule_realtime_thread(self):
        try:
            asyncio.run(self._schedule_realtime_main())
        except Exception as e:
            self._sched_realtime_connected = False
            self._sched_realtime_error = str(e)
            print(f"[SCHED][RT] Realtime thread exited with error: {e}")

    def _run_preferences_realtime_thread(self):
        try:
            asyncio.run(self._preferences_realtime_main())
        except Exception as e:
            self._pref_realtime_connected = False
            self._pref_realtime_error = str(e)
            print(f"[PREF][RT] Realtime thread exited with error: {e}")

    async def _schedule_realtime_main(self):
        if not self._sched_realtime_enabled:
            return

        if not SUPABASE_PY_AVAILABLE:
            self._sched_realtime_error = "supabase-py not installed"
            print("[SCHED][RT] supabase-py not installed; using fallback polling only.")
            return

        if not self.supabase_url or not self.supabase_key or not self.pi_id:
            self._sched_realtime_error = "missing supabase config"
            print("[SCHED][RT] Missing SUPABASE_URL, SUPABASE_KEY, or SOLARIS_PI_ID; using fallback polling only.")
            return

        self._sched_rt_loop = asyncio.get_running_loop()
        self._sched_rt_client = supabase_create_client(self.supabase_url, self.supabase_key)
        channel_name = f"schedule-watch-{self.pi_id}"
        filter_expr = f"pi_id=eq.{self.pi_id}"

        def _handle_schedule_change(payload):
            self._sched_realtime_last_event_ts = time.time()
            print(f"[SCHED][RT] Change event received: {payload}")
            threading.Thread(
                target=self._refresh_schedule_now,
                kwargs={"reason": "realtime_event"},
                daemon=True,
            ).start()

        try:
            self._sched_rt_channel = self._sched_rt_client.channel(channel_name)
            await (
                self._sched_rt_channel
                .on_postgres_changes(
                    "*",
                    schema="public",
                    table="schedules",
                    filter=filter_expr,
                    callback=_handle_schedule_change,
                )
                .subscribe()
            )
            self._sched_realtime_connected = True
            self._sched_realtime_error = ""
            print(f"[SCHED][RT] Subscribed to schedules changes for pi_id={self.pi_id}")

            while not self._stop_event.is_set():
                await asyncio.sleep(1.0)

        except Exception as e:
            self._sched_realtime_connected = False
            self._sched_realtime_error = str(e)
            print(f"[SCHED][RT] Subscribe failed: {e}")

        finally:
            self._sched_realtime_connected = False
            try:
                if self._sched_rt_channel is not None:
                    await self._sched_rt_channel.unsubscribe()
            except Exception:
                pass

    async def _preferences_realtime_main(self):
        if not self._pref_realtime_enabled:
            return

        if not SUPABASE_PY_AVAILABLE:
            self._pref_realtime_error = "supabase-py not installed"
            print("[PREF][RT] supabase-py not installed; using fallback polling only.")
            return

        if not self.supabase_url or not self.supabase_key or not self.user_id:
            self._pref_realtime_error = "missing supabase config or user id"
            print("[PREF][RT] Missing SUPABASE_URL, SUPABASE_KEY, or SOLARIS_USER_ID; using fallback polling only.")
            return

        self._pref_rt_loop = asyncio.get_running_loop()
        self._pref_rt_client = supabase_create_client(self.supabase_url, self.supabase_key)
        channel_name = f"preferences-watch-{self.user_id}"
        filter_expr = f"user_id=eq.{self.user_id}"

        def _handle_preferences_change(payload):
            self._pref_realtime_last_event_ts = time.time()
            print(f"[PREF][RT] Change event received: {payload}")
            threading.Thread(
                target=self._refresh_preferences_now,
                kwargs={"reason": "realtime_event"},
                daemon=True,
            ).start()

        try:
            self._pref_rt_channel = self._pref_rt_client.channel(channel_name)
            await (
                self._pref_rt_channel
                .on_postgres_changes(
                    "*",
                    schema="public",
                    table="user_preferences",
                    filter=filter_expr,
                    callback=_handle_preferences_change,
                )
                .subscribe()
            )
            self._pref_realtime_connected = True
            self._pref_realtime_error = ""
            print(f"[PREF][RT] Subscribed to user_preferences changes for user_id={self.user_id}")

            while not self._stop_event.is_set():
                await asyncio.sleep(1.0)

        except Exception as e:
            self._pref_realtime_connected = False
            self._pref_realtime_error = str(e)
            print(f"[PREF][RT] Subscribe failed: {e}")

        finally:
            self._pref_realtime_connected = False
            try:
                if self._pref_rt_channel is not None:
                    await self._pref_rt_channel.unsubscribe()
            except Exception:
                pass

# -------------------- SCHEDULED MODE HELPERS --------------------
    def _parse_time_of_day(self, value):
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None

        try:
            parts = s.split(":")
            if 2 <= len(parts) <= 3 and all(p.isdigit() for p in parts):
                hh = int(parts[0])
                mm = int(parts[1])
                ss = int(parts[2]) if len(parts) == 3 else 0
                return datetime.time(hour=hh, minute=mm, second=ss)
        except Exception:
            pass

        try:
            dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is not None:
                dt = dt.astimezone()
            return dt.time().replace(microsecond=0)
        except Exception:
            return None

    def _apply_user_preferences_row(self, row):
        self.pref_light_on_duration = row.get("light_on_duration")
        self.pref_video_clip_duration = row.get("video_clip_duration")
        self.pref_motion_sensitivity = row.get("motion_sensitivity")
        self.pref_auto_delete_after_days = row.get("auto_delete_after_days")
        self.pref_notifications_enabled = row.get("notifications_enabled")
        self.pref_night_mode_enabled = row.get("night_mode_enabled")
        self.pref_created_at = row.get("created_at")
        self.pref_updated_at = row.get("updated_at")

        if self.pref_light_on_duration is not None:
            try:
                hold_sec = float(self.pref_light_on_duration)
                self.porch_hold_sec = hold_sec
                self.foyer_hold_sec = hold_sec
            except Exception:
                pass

        if self.pref_video_clip_duration is not None:
            try:
                self.record_duration_sec = int(self.pref_video_clip_duration)
            except Exception:
                pass

    def _fetch_user_preferences(self):
        if not self.supabase_url or not self.supabase_key or not self.user_id:
            self._pref_last_fetch_ok = False
            return False

        url = f"{self.supabase_url}/rest/v1/user_preferences"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Accept": "application/json",
        }
        params = {
            "select": "light_on_duration,video_clip_duration,motion_sensitivity,auto_delete_after_days,notifications_enabled,night_mode_enabled,created_at,updated_at",
            "user_id": f"eq.{self.user_id}",
            "order": "updated_at.desc",
            "limit": "1",
        }

        try:
            r = requests.get(url, headers=headers, params=params, timeout=3.5)
            r.raise_for_status()
            rows = r.json() or []
            print(f"[PREF] Fetch response rows={rows}")

            if not rows:
                self._pref_last_fetch_ok = False
                return False

            row = rows[0]
            self._apply_user_preferences_row(row)
            self._pref_last_fetch_ok = True
            print(
                "[PREF] Using preferences "
                f"light_on_duration={self.pref_light_on_duration}, "
                f"video_clip_duration={self.pref_video_clip_duration}, "
                f"motion_sensitivity={self.pref_motion_sensitivity}, "
                f"auto_delete_after_days={self.pref_auto_delete_after_days}, "
                f"notifications_enabled={self.pref_notifications_enabled}, "
                f"night_mode_enabled={self.pref_night_mode_enabled}"
            )
            return True
        except Exception as e:
            print(f"[WARN] Preferences fetch failed: {e}")
            self._pref_last_fetch_ok = False
            return False

    def _fetch_schedule_window(self):
        if not self.supabase_url or not self.supabase_key or not self.pi_id:
            self._sched_last_fetch_ok = False
            return False

        url = f"{self.supabase_url}/rest/v1/schedules"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Accept": "application/json",
        }
        params = {
            "select": "start_time,end_time,days_of_week",
            "pi_id": f"eq.{self.pi_id}",
            "order": "updated_at.desc",
            "limit": "1",
        }

        try:
            r = requests.get(url, headers=headers, params=params, timeout=3.5)
            r.raise_for_status()
            rows = r.json() or []
            print(f"[SCHED] Fetch response rows={rows}")

            if not rows:
                self._sched_start_time = None
                self._sched_end_time = None
                self._sched_days_of_week = []
                self._sched_last_fetch_ok = False
                return False

            row = rows[0]
            start_t = self._parse_time_of_day(row.get("start_time"))
            end_t = self._parse_time_of_day(row.get("end_time"))
            days = row.get("days_of_week") or []

            if start_t is None or end_t is None:
                self._sched_last_fetch_ok = False
                return False

            self._sched_start_time = start_t
            self._sched_end_time = end_t
            self._sched_days_of_week = [str(d).strip().lower() for d in days if str(d).strip()]
            self._sched_last_fetch_ok = True
            print(f"[SCHED] Using schedule start={start_t}, end={end_t}, days={self._sched_days_of_week}")
            return True
        except Exception as e:
            print(f"[WARN] Schedule fetch failed: {e}")
            self._sched_last_fetch_ok = False
            return False

    def _scheduled_window_allows_operation(self, now_ts: float) -> bool:
        should_fallback_refresh = False

        if self._sched_start_time is None or self._sched_end_time is None:
            should_fallback_refresh = True
        elif (now_ts - self._sched_last_fetch_ts) >= self._sched_poll_fallback_interval_sec:
            should_fallback_refresh = True

        if should_fallback_refresh:
            self._refresh_schedule_now(reason="fallback_poll")

        if (self._pref_last_fetch_ts == 0.0) or ((now_ts - self._pref_last_fetch_ts) >= self._pref_poll_fallback_interval_sec):
            self._refresh_preferences_now(reason="fallback_poll")

        if self._sched_start_time is None or self._sched_end_time is None:
            return False

        now_dt = datetime.datetime.now().astimezone()
        now_local = now_dt.time().replace(microsecond=0)
        today_name = now_dt.strftime("%A").lower()

        start_t = self._sched_start_time
        end_t = self._sched_end_time
        allowed_days = self._sched_days_of_week

        day_allowed = True if not allowed_days else (today_name in allowed_days)

        if start_t <= end_t:
            in_time = start_t <= now_local < end_t
        else:
            in_time = (now_local >= start_t) or (now_local < end_t)

        print(
            f"[SCHED] Check: now={now_local}, today={today_name}, "
            f"start={start_t}, end={end_t}, in_time={in_time}, day_allowed={day_allowed}"
        )

        return bool(day_allowed and in_time)


# ==================== FLASK APP ====================
app = Flask(__name__)
CORS(app)

ctrl = SolarisController()
ctrl.start()


def _json_error(msg, code=400):
    return jsonify({"ok": False, "error": msg}), code


@app.route("/")
def home():
    return jsonify({
        "service": "Solaris Pi API + Controller",
        "status": "running",
        "endpoints": [
            "/health",
            "/api/status",
            "/api/mode",
            "/api/manual",
            "/api/config",
            "/api/record/porch",
            "/videos",
            "/videos/<filename>",
        ],
    })


@app.route("/health")
def health():
    return jsonify({
        "status": "online",
        "timestamp": datetime.datetime.now().isoformat(),
        "mode": ctrl.mode,
    })


@app.route("/api/status")
def api_status():
    with ctrl._lock:
        tracker_age_sec = None
        if ctrl.tracker_last_rx_ts is not None:
            tracker_age_sec = time.time() - ctrl.tracker_last_rx_ts

        return jsonify({
            "ok": True,
            "mode": ctrl.mode,
            "manual": {"porch": ctrl.manual_porch, "foyer": ctrl.manual_foyer},
            "motion": {"porch": ctrl.motion_porch, "foyer": ctrl.motion_foyer},
            "lux": {
                "porch": ctrl.lux_porch,
                "foyer": ctrl.lux_foyer,
                "porch_valid": ctrl.bh_porch_valid,
                "foyer_valid": ctrl.bh_foyer_valid,
            },
            "lights": {"porch": ctrl.light_porch_state, "foyer": ctrl.light_foyer_state},
            "tracker": {
                "uart_enabled": ctrl.uart_enabled,
                "uart_port": ctrl.uart_port,
                "uart_baud": ctrl.uart_baud,
                "battery_v": ctrl.tracker_battery_v,
                "battery_pct": ctrl.tracker_battery_pct,
                "lux": ctrl.tracker_lux,
                "lim_left": ctrl.tracker_lim_left,
                "lim_right": ctrl.tracker_lim_right,
                "motor_state": ctrl.tracker_motor_state,
                "last_rx_age_sec": tracker_age_sec,
                "last_line": ctrl.tracker_last_line,
            },
            "schedule": {
                "pi_id": ctrl.pi_id,
                "start_time": str(ctrl._sched_start_time) if ctrl._sched_start_time else None,
                "end_time": str(ctrl._sched_end_time) if ctrl._sched_end_time else None,
                "days_of_week": ctrl._sched_days_of_week,
                "last_fetch_ok": ctrl._sched_last_fetch_ok,
                "fallback_poll_interval_sec": ctrl._sched_poll_fallback_interval_sec,
                "realtime_enabled": ctrl._sched_realtime_enabled,
                "realtime_connected": ctrl._sched_realtime_connected,
                "realtime_last_event_ts": ctrl._sched_realtime_last_event_ts,
                "realtime_error": ctrl._sched_realtime_error,
            },
            "preferences": {
                "user_id": ctrl.user_id,
                "last_fetch_ok": ctrl._pref_last_fetch_ok,
                "fallback_poll_interval_sec": ctrl._pref_poll_fallback_interval_sec,
                "realtime_enabled": ctrl._pref_realtime_enabled,
                "realtime_connected": ctrl._pref_realtime_connected,
                "realtime_last_event_ts": ctrl._pref_realtime_last_event_ts,
                "realtime_error": ctrl._pref_realtime_error,
                "light_on_duration": ctrl.pref_light_on_duration,
                "video_clip_duration": ctrl.pref_video_clip_duration,
                "motion_sensitivity": ctrl.pref_motion_sensitivity,
                "auto_delete_after_days": ctrl.pref_auto_delete_after_days,
                "notifications_enabled": ctrl.pref_notifications_enabled,
                "night_mode_enabled": ctrl.pref_night_mode_enabled,
                "created_at": ctrl.pref_created_at,
                "updated_at": ctrl.pref_updated_at,
            },
            "config": {
                "outdoor_dark_lx": ctrl.outdoor_dark_lx,
                "indoor_dim_lx": ctrl.indoor_dim_lx,
                "porch_hold_sec": ctrl.porch_hold_sec,
                "foyer_hold_sec": ctrl.foyer_hold_sec,
                "loop_dt": ctrl.loop_dt,
                "record_enabled": ctrl.record_enabled,
                "record_duration_sec": ctrl.record_duration_sec,
                "porch_record_cooldown_sec": ctrl.porch_record_cooldown_sec,
            }
        })


@app.route("/api/mode", methods=["POST"])
def api_mode():
    data = request.get_json(silent=True) or {}
    mode = str(data.get("mode", "")).strip().lower()
    print(f"[API] /api/mode from {request.remote_addr} body={data}")

    if mode == "auto":
        mode = "automatic"

    if mode not in ("automatic", "manual", "scheduled"):
        return _json_error("mode must be one of: automatic, manual, scheduled")

    with ctrl._lock:
        ctrl.mode = mode
        if mode != "manual":
            ctrl.manual_porch = False
            ctrl.manual_foyer = False
        if mode == "scheduled":
            ctrl._sched_last_fetch_ts = 0.0
            ctrl._refresh_schedule_now(reason="mode_switch")

    return jsonify({"ok": True, "mode": mode})


@app.route("/api/manual", methods=["POST"])
def api_manual():
    data = request.get_json(silent=True) or {}
    print(f"[API] /api/manual from {request.remote_addr} body={data}")

    porch = data.get("porch", None)
    foyer = data.get("foyer", None)

    if porch is None and foyer is None:
        return _json_error("provide porch and/or foyer boolean")

    with ctrl._lock:
        ctrl.mode = "manual"
        if porch is not None:
            ctrl.manual_porch = bool(porch)
        if foyer is not None:
            ctrl.manual_foyer = bool(foyer)

    return jsonify({"ok": True, "mode": "manual", "manual": {"porch": ctrl.manual_porch, "foyer": ctrl.manual_foyer}})


@app.route("/api/config", methods=["POST"])
def api_config():
    data = request.get_json(silent=True) or {}
    with ctrl._lock:
        if "outdoor_dark_lx" in data:
            ctrl.outdoor_dark_lx = float(data["outdoor_dark_lx"])
        if "indoor_dim_lx" in data:
            ctrl.indoor_dim_lx = float(data["indoor_dim_lx"])
        if "porch_hold_sec" in data:
            ctrl.porch_hold_sec = float(data["porch_hold_sec"])
        if "foyer_hold_sec" in data:
            ctrl.foyer_hold_sec = float(data["foyer_hold_sec"])
        if "loop_dt" in data:
            ctrl.loop_dt = float(data["loop_dt"])

        if "record_enabled" in data:
            ctrl.record_enabled = bool(data["record_enabled"])
        if "record_duration_sec" in data:
            ctrl.record_duration_sec = int(data["record_duration_sec"])
        if "porch_record_cooldown_sec" in data:
            ctrl.porch_record_cooldown_sec = float(data["porch_record_cooldown_sec"])
        if "motion_sensitivity" in data:
            ctrl.pref_motion_sensitivity = int(data["motion_sensitivity"])
        if "auto_delete_after_days" in data:
            ctrl.pref_auto_delete_after_days = int(data["auto_delete_after_days"])
        if "notifications_enabled" in data:
            ctrl.pref_notifications_enabled = bool(data["notifications_enabled"])
        if "night_mode_enabled" in data:
            ctrl.pref_night_mode_enabled = bool(data["night_mode_enabled"])

    return jsonify({"ok": True})


@app.route("/api/record/porch", methods=["POST"])
def api_record_porch():
    ok, msg = ctrl.trigger_porch_recording_async()
    code = 200 if ok else 409
    return jsonify({"ok": ok, "message": msg}), code


# ==================== VIDEO SERVING (FROM captures/) ====================
@app.route("/videos")
def list_videos():
    try:
        items = []
        for filename in sorted(os.listdir(CAPTURE_DIR), reverse=True):
            if filename.endswith(".mp4"):
                fp = CAPTURE_DIR / filename
                st = fp.stat()
                items.append({
                    "filename": filename,
                    "size": st.st_size,
                    "modified": st.st_mtime,
                })
        return jsonify(items)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/videos/<path:filename>")
def serve_video(filename):
    fp = CAPTURE_DIR / filename
    if not fp.exists():
        return jsonify({"ok": False, "error": f"File not found: {filename}"}), 404
    try:
        return send_file(str(fp), mimetype="video/mp4", as_attachment=False, download_name=filename)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ==================== CLEAN SHUTDOWN ====================
def _handle_exit(signum, frame):
    print(f"\n[SYS] Signal {signum} received, shutting down...")
    ctrl.stop()
    raise SystemExit(0)


signal.signal(signal.SIGINT, _handle_exit)
signal.signal(signal.SIGTERM, _handle_exit)


if __name__ == "__main__":
    print("=" * 60)
    print("Solaris API + Controller starting")
    print("=" * 60)
    print(f"Captures dir: {CAPTURE_DIR}")
    print(f"UART enabled: {ctrl.uart_enabled} | port={ctrl.uart_port} | baud={ctrl.uart_baud}")
    print(f"Schedule pi_id: {ctrl.pi_id}")
    print(f"Preferences user_id: {ctrl.user_id}")
    print(f"Schedule realtime enabled: {ctrl._sched_realtime_enabled} | fallback poll sec: {ctrl._sched_poll_fallback_interval_sec}")
    print(f"Preferences realtime enabled: {ctrl._pref_realtime_enabled} | fallback poll sec: {ctrl._pref_poll_fallback_interval_sec}")
    print("Server running on: http://0.0.0.0:5001")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5001, debug=False, use_reloader=False)










