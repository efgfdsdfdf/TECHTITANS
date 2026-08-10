package com.techtitans.app;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class CallActionClient {
    private static final String TAG = "TechTitansCallAction";

    private CallActionClient() {}

    static boolean sendDeviceAction(Context context, String callId, String action) {
        if (callId == null || callId.isEmpty()) return false;

        HttpURLConnection connection = null;
        try {
            JSONObject payload = new JSONObject();
            payload.put("callId", callId);
            payload.put("action", action);
            payload.put("deviceIdentifier", DeviceIdentityStore.getInstallId(context));
            payload.put("deviceSecret", DeviceIdentityStore.getDeviceSecret(context));

            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(TechTitansCallConstants.CALL_DEVICE_ACTION_URL).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(12000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY);

            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }

            int status = connection.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception error) {
            Log.w(TAG, "Unable to send native call action", error);
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
