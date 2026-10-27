const sessionFlags = {
  homeOnce: false,
  bookOpenOnce: false,
};

export function shouldShowAds(user: any | null) {
  if (!user) return true
  const role = (user.role || '').toString().toLowerCase()
  if (role === 'admin' || role === 'author') return false
  const until = user.vip_until ? new Date(user.vip_until).getTime() : NaN
  if (role === 'vip' && !user.vip_until) return false
  if (Number.isFinite(until) && until > Date.now()) return false
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
