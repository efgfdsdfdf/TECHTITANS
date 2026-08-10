package com.techtitans.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.SecureRandom;
import java.util.UUID;

final class DeviceIdentityStore {
    private static final String PREFS = "techtitans_call_device";
    private static final String KEY_INSTALL_ID = "install_id";
    private static final String KEY_DEVICE_SECRET = "device_secret";
    private static final String KEY_FCM_TOKEN = "fcm_token";

    private DeviceIdentityStore() {}

    static String getInstallId(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String value = prefs.getString(KEY_INSTALL_ID, null);
        if (value != null) return value;
        value = UUID.randomUUID().toString();
        prefs.edit().putString(KEY_INSTALL_ID, value).apply();
        return value;
    }

    static String getDeviceSecret(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String value = prefs.getString(KEY_DEVICE_SECRET, null);
        if (value != null) return value;

        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        StringBuilder builder = new StringBuilder();
        for (byte b : bytes) builder.append(String.format("%02x", b));
        value = builder.toString();
        prefs.edit().putString(KEY_DEVICE_SECRET, value).apply();
        return value;
    }

    static void saveFcmToken(Context context, String token) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_FCM_TOKEN, token)
            .apply();
    }

    static String getFcmToken(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_FCM_TOKEN, null);
    }
}
