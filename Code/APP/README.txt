The SOLARIS app serves as the bridge between the user and the SOLARIS device.
Coded using Expo's React Native dev tools and tested in Android devices with Android API 25 and newer.

-> The user can read general status information and set preferences within the app, all data protected and tracked via SUPABASE (free version).
-> SOLARIS security features are also accessed through this app. RasPi hosts video files, these get tunneled through Cloudflare services and hosted in
   solaris-lights.online/${pi_id}. Extra security features will be added so that the website can only be accessed through the app or something like that.
