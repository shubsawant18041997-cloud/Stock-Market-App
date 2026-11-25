import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { colors } from './src/theme';
import MarketsScreen from './src/screens/MarketsScreen';
import SearchScreen from './src/screens/SearchScreen';
import DetailScreen from './src/screens/DetailScreen';
import AlertsScreen from './src/screens/AlertsScreen';
import AlertEditorScreen from './src/screens/AlertEditorScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import NewsScreen from './src/screens/NewsScreen';
import MacroScreen from './src/screens/MacroScreen';
import PairScreen from './src/screens/PairScreen';
import { registerForPush } from './src/notifications';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const navRef = createNavigationContainerRef<any>();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, border: colors.border, primary: colors.accent, text: colors.text },
};

type IconName = React.ComponentProps<typeof Ionicons>['name'];
// filled icon when the tab is active, outline otherwise
const icon =
  (name: string) =>
  ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={(focused ? name : `${name}-outline`) as IconName} size={22} color={color} />
  );

function HomeTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        animation: 'shift',
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.bg, elevation: 0, shadowOpacity: 0, borderBottomWidth: 0 },
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen name="Markets" component={MarketsScreen} options={{ tabBarIcon: icon('stats-chart') }} />
      <Tabs.Screen name="News" component={NewsScreen} options={{ title: 'Market news', tabBarLabel: 'News', tabBarIcon: icon('newspaper') }} />
      <Tabs.Screen name="Macro" component={MacroScreen} options={{ title: 'Macro & correlations', tabBarLabel: 'Macro', tabBarIcon: icon('compass') }} />
      <Tabs.Screen name="Alerts" component={AlertsScreen} options={{ tabBarIcon: icon('notifications') }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: icon('settings') }} />
    </Tabs.Navigator>
  );
}

export default function App() {
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // best effort: silently register for push on launch (Settings shows details if it fails)
    registerForPush().catch(() => {});
    // tapping a notification opens that symbol
    responseListener.current = Notifications.addNotificationResponseReceivedListener((resp) => {
      const d: any = resp.notification.request.content.data;
      if (d?.market && d?.symbol && navRef.isReady()) navRef.navigate('Detail', { market: d.market, symbol: d.symbol });
    });
    return () => responseListener.current?.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme} ref={navRef}>
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            animation: 'slide_from_right',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.bg },
            headerTitleStyle: { fontWeight: '700' },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="Home" component={HomeTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Detail" component={DetailScreen} />
          <Stack.Screen name="Pair" component={PairScreen} options={{ title: 'Correlation' }} />
          <Stack.Screen name="Search"component={SearchScreen} options={{ title: 'Add symbol', presentation: 'modal' }} />
          <Stack.Screen name="AlertEditor" component={AlertEditorScreen} options={{ title: 'Alert', presentation: 'modal' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
