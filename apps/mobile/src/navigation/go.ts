const TABS = ['Home', 'Explore', 'Goals', 'Portfolio', 'Profile'];
/** Navigate to a tab or a stack screen from anywhere. */
export function go(nav: any, route: string, params?: any) {
  if (TABS.includes(route)) nav.navigate('MainTabs', { screen: route, params });
  else nav.navigate(route, params);
}
