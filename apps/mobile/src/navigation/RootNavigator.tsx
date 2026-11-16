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
import { ArticleScreen, CategoryScreen, CompareScreen, ExploreScreen, SchemeScreen, WatchlistScreen } from '../screens/explore/ExploreScreens';
import { ChallengeScreen, QuizScreen } from '../screens/learn/LearnScreens';
import { InboxScreen } from '../screens/inbox/InboxScreen';
import { FamilyHubScreen, FamilyMemberScreen } from '../screens/family/FamilyScreens';
import { AccountRequestScreen, ConsentHistoryScreen, FaqScreen, LegalDocScreen, LegalScreen } from '../screens/legal/LegalScreens';
import { RiskLegacyAssessScreen, RiskLegacyHistoryScreen, RiskLegacyHubScreen, RiskLegacyResultScreen } from '../screens/risk/RiskScreens';
import { RiskAssessScreen, RiskHistoryScreen, RiskHubScreen, RiskResultScreen } from '../screens/risk/RiskV1Screens';
import { GoalCompareScreen, GoalDetailScreen, GoalFormScreen, GoalsScreen } from '../screens/goals/GoalsScreens';
import { HomeScreen } from '../screens/home/HomeScreen';
import { PortfolioScreen, TransactionsScreen, WithdrawalScreen } from '../screens/portfolio/PortfolioScreen';
import { AddressScreen, BankScreen, ConsentScreen, GuardianScreen, KycScreen, NomineeScreen, OnboardingScreen, PersonalScreen, ReviewScreen, RiskScreen } from '../screens/onboarding/OnboardingScreens';
import { ChangePasswordScreen, LanguageScreen, NotificationsScreen, ProfileScreen, SecurityScreen } from '../screens/profile/ProfileScreens';
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
      <AppStack.Screen name="Onboarding" component={OnboardingScreen} />
      <AppStack.Screen name="ObPersonal" component={PersonalScreen} />
      <AppStack.Screen name="ObGuardian" component={GuardianScreen} />
      <AppStack.Screen name="ObAddress" component={AddressScreen} />
      <AppStack.Screen name="ObBank" component={BankScreen} />
      <AppStack.Screen name="ObNominee" component={NomineeScreen} />
      <AppStack.Screen name="ObRisk" component={RiskScreen} />
      <AppStack.Screen name="ObConsent" component={ConsentScreen} />
      <AppStack.Screen name="ObReview" component={ReviewScreen} />
      <AppStack.Screen name="Article" component={ArticleScreen} />
      <AppStack.Screen name="Scheme" component={SchemeScreen} />
      <AppStack.Screen name="GoalForm" component={GoalFormScreen} />
      <AppStack.Screen name="GoalDetail" component={GoalDetailScreen} />
      <AppStack.Screen name="Kyc" component={KycScreen} />
      <AppStack.Screen name="Language" component={LanguageScreen} />
      <AppStack.Screen name="Notifications" component={NotificationsScreen} />
      <AppStack.Screen name="Security" component={SecurityScreen} />
      <AppStack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <AppStack.Screen name="Inbox" component={InboxScreen} />
      <AppStack.Screen name="Category" component={CategoryScreen} />
      <AppStack.Screen name="Compare" component={CompareScreen} />
      <AppStack.Screen name="Watchlist" component={WatchlistScreen} />
      <AppStack.Screen name="Quiz" component={QuizScreen} />
      <AppStack.Screen name="Challenge" component={ChallengeScreen} />
      <AppStack.Screen name="GoalCompare" component={GoalCompareScreen} />
      <AppStack.Screen name="RiskHub" component={RiskHubScreen} />
      <AppStack.Screen name="RiskAssess" component={RiskAssessScreen} />
      <AppStack.Screen name="RiskResult" component={RiskResultScreen} />
      <AppStack.Screen name="RiskHistory" component={RiskHistoryScreen} />
      <AppStack.Screen name="RiskLegacyHub" component={RiskLegacyHubScreen} />
      <AppStack.Screen name="RiskLegacyAssess" component={RiskLegacyAssessScreen} />
      <AppStack.Screen name="RiskLegacyResult" component={RiskLegacyResultScreen} />
      <AppStack.Screen name="RiskLegacyHistory" component={RiskLegacyHistoryScreen} />
      <AppStack.Screen name="Transactions" component={TransactionsScreen} />
      <AppStack.Screen name="Withdrawal" component={WithdrawalScreen} />
      <AppStack.Screen name="FamilyHub" component={FamilyHubScreen} />
      <AppStack.Screen name="FamilyMember" component={FamilyMemberScreen} />
      <AppStack.Screen name="Legal" component={LegalScreen} />
      <AppStack.Screen name="LegalDoc" component={LegalDocScreen} />
      <AppStack.Screen name="ConsentHistory" component={ConsentHistoryScreen} />
      <AppStack.Screen name="Faq" component={FaqScreen} />
      <AppStack.Screen name="AccountRequest" component={AccountRequestScreen} />
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
      <AuthStack.Screen name="LegalDoc" component={LegalDocScreen} />
    </AuthStack.Navigator>
  );
}
