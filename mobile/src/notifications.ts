import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushResult = { ok: true; token: string } | { ok: false; reason: string };

/**
 * Ask for permission, get this device's Expo push token and register it with
 * the server. Remote push needs a physical device and an EAS project id
 * (run `npx eas init` once). Expo Go on Android does not support remote push
 * since SDK 53, so use a development build there (`npx expo run:android`
 * or `eas build --profile development`).
 */
export async function registerForPush(): Promise<PushResult> {
  try {
    if (!Device.isDevice) return { ok: false, reason: 'Push notifications need a physical device.' };

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Market alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4c8dff',
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return { ok: false, reason: 'Notification permission was denied.' };

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return { ok: false, reason: 'No EAS projectId. Run `npx eas init` in the mobile folder, then restart.' };

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api.registerDevice(token, Platform.OS);
    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
