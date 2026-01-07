const sessionFlags = {
  homeOnce: false,
  bookOpenOnce: false,
};

export function shouldShowAds(user: any | null) {
  // Guests (null) and normal users see ads. VIPs and authors don't.
  if (!user) return true
  const role = (user.role || '').toString().toLowerCase()
  if (!role) return true
  if (role === 'vip' || role === 'author' || role === 'admin') return false
  // also honor vip_until if present
  if (user.vip_until) return false
  return true
}

export function shouldShowPlacement(placement: 'home-once' | 'book-open-once', user: any | null) {
  if (!shouldShowAds(user)) return false
  if (placement === 'home-once') {
    if (sessionFlags.homeOnce) return false
    sessionFlags.homeOnce = true
    return true
  }
  if (placement === 'book-open-once') {
    if (sessionFlags.bookOpenOnce) return false
    sessionFlags.bookOpenOnce = true
    return true
  }
  return false
}

export default { shouldShowAds, shouldShowPlacement }
