function getCurrentPositionAsync(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

// Best-effort GPS fix for a time clock punch. Never blocks the punch:
// resolves to null coordinates on denied permission, timeout, or an
// unsupported browser. Two things can go wrong independently, so this
// handles both:
// 1. The timeout has to cover more than just the fix itself — it starts
//    counting the instant getCurrentPosition is called, before the
//    browser's permission prompt even appears, so time spent reading and
//    tapping "Allow" eats into it too.
// 2. enableHighAccuracy demands a GPS-chip-level fix. Plenty of real
//    devices (most laptops/desktops, phones indoors) can't provide one and
//    fail immediately with POSITION_UNAVAILABLE even with permission
//    granted — that's a different failure than a timeout and needs a
//    retry at lower accuracy (Wi-Fi/IP based), not a longer wait.
export async function getPunchLocation() {
  if (!navigator.geolocation) return { lat: null, lng: null, accuracy: null };
  try {
    const pos = await getCurrentPositionAsync({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  } catch (e) {
    // PERMISSION_DENIED (code 1) won't succeed on retry either — only retry
    // on TIMEOUT or POSITION_UNAVAILABLE.
    if (e && e.code === 1) return { lat: null, lng: null, accuracy: null };
    try {
      const pos = await getCurrentPositionAsync({ enableHighAccuracy: false, timeout: 12000, maximumAge: 0 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    } catch (e2) {
      return { lat: null, lng: null, accuracy: null };
    }
  }
}
