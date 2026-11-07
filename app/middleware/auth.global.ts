export default defineNuxtRouteMiddleware((to) => {
  if (!useBackend().requiresAuth || useInitError().value) return
  const signedIn = !!useUserId().value

  if (!signedIn && to.path !== '/login') {
    return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } })
  }
  if (signedIn && to.path === '/login') {
    return navigateTo(safeRedirect(to.query.redirect))
  }
})
