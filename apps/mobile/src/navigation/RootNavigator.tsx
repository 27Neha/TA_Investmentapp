import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { useI18n } from '../i18n';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import VerifyEmailScreen from '../screens/auth/VerifyEmailScreen';
import WelcomeScreen from '../screens/auth/WelcomeScreen';
import { SupportScreen } from '../screens/main/SupportScreen';
import { ExploreScreen, GoalsScreen, HomeScreen, PortfolioScreen, ProfileScreen } from '../screens/main/MainScreens';
import { colors } from '../theme/tokens';

const AuthStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const AppStack = createNativeStackNavigator();

function MainTabs() {
  const { t } = useI18n();
  // Single shared shell: header (logo) is rendered once by the tab navigator's header; titles live in screen content.
  return (
    <Tabs.Navigator screenOptions={{ header: () => <AppHeader navigation={{} as any} back={undefined} options={{}} route={{} as any} />, tabBarActiveTintColor: colors.primary, tabBarLabelStyle: { fontSize: 12 } }}>
      <Tabs.Screen name="Home" component={HomeScreen} options={{ title: t('tabs.home'), tabBarLabel: t('tabs.home') }} />
      <Tabs.Screen name="Explore" component={ExploreScreen} options={{ title: t('tabs.explore'), tabBarLabel: t('tabs.explore') }} />
      <Tabs.Screen name="Goals" component={GoalsScreen} options={{ title: t('tabs.goals'), tabBarLabel: t('tabs.goals') }} />
      <Tabs.Screen name="Portfolio" component={PortfolioScreen} options={{ title: t('tabs.portfolio'), tabBarLabel: t('tabs.portfolio') }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: t('tabs.profile'), tabBarLabel: t('tabs.profile') }} />
    </Tabs.Navigator>
  );
}

export default function RootNavigator() {
  const { ready, signedIn } = useAuth();
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  // Home is a root tab: it never navigates to Login. Signing out swaps the whole tree, so there is no invalid back route.
  if (signedIn) return (
    <AppStack.Navigator screenOptions={{ header: (p) => <AppHeader {...p} /> }}>
      <AppStack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <AppStack.Screen name="Support" component={SupportScreen} />
    </AppStack.Navigator>
  );
  return (
    <AuthStack.Navigator initialRouteName="Welcome" screenOptions={{ header: (p) => <AppHeader {...p} /> }}>
      <AuthStack.Screen name="Welcome" component={WelcomeScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
      <AuthStack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <AuthStack.Screen name="Support" component={SupportScreen} />
    </AuthStack.Navigator>
  );
}
