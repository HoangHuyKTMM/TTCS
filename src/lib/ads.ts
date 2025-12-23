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

export default { shouldShowAds }
