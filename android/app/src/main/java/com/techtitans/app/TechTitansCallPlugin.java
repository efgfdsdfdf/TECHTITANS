package com.techtitans.app;

import android.Manifest;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(
    name = "TechTitansCall",
    permissions = {
        @Permission(
            alias = "callMedia",
            strings = {
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA
            }
        ),
        @Permission(
            alias = "notifications",
            strings = {
                Manifest.permission.POST_NOTIFICATIONS
            }
        )
    }
)
public class TechTitansCallPlugin extends Plugin {
    private static final String TAG = "TechTitansCallPlugin";
    private static Bundle pendingCallAction;
    private static Bundle pendingNotificationAction;

    static void setPendingCallAction(Bundle callAction) {
        pendingCallAction = callAction;
    }

    static void setPendingNotificationAction(Bundle notificationAction) {
        pendingNotificationAction = notificationAction;
    }

    @Override
    public void load() {
        IncomingCallNotification.createChannel(getContext());
        TechTitansNotificationCenter.createChannel(getContext());
    }

    @PluginMethod
    public void requestCallPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
            return;
        }

        if (getPermissionState("callMedia") != PermissionState.GRANTED) {
            requestPermissionForAlias("callMedia", call, "mediaPermissionCallback");
            return;
        }

        resolvePermissionState(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        if (getPermissionState("callMedia") != PermissionState.GRANTED) {
            requestPermissionForAlias("callMedia", call, "mediaPermissionCallback");
            return;
        }
        resolvePermissionState(call);
    }

    @PermissionCallback
    private void mediaPermissionCallback(PluginCall call) {
        resolvePermissionState(call);
    }

    private void resolvePermissionState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("notifications", getPermissionState("notifications").toString());
        result.put("callMedia", getPermissionState("callMedia").toString());
        call.resolve(result);
    }

    @PluginMethod
    public void registerCallDevice(PluginCall call) {
        String supabaseUrl = call.getString("supabaseUrl", TechTitansCallConstants.SUPABASE_URL);
        String accessToken = call.getString("accessToken");
        if (accessToken == null || accessToken.isEmpty()) {
            call.reject("A Supabase access token is required.");
            return;
        }

        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(token -> {
                DeviceIdentityStore.saveFcmToken(getContext(), token);
                new Thread(() -> registerDevice(call, supabaseUrl, accessToken, token)).start();
            })
            .addOnFailureListener(error -> call.reject("Unable to obtain FCM token.", error));
    }

    @PluginMethod
    public void getPendingCallAction(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingCallAction != null) {
            result.put("event", pendingCallAction.getString("nativeCallEvent"));
            result.put("callId", pendingCallAction.getString(TechTitansCallConstants.EXTRA_CALL_ID));
            result.put("callType", pendingCallAction.getString(TechTitansCallConstants.EXTRA_CALL_TYPE));
            result.put("roomId", pendingCallAction.getString(TechTitansCallConstants.EXTRA_ROOM_ID));
            result.put("callerId", pendingCallAction.getString(TechTitansCallConstants.EXTRA_CALLER_ID));
            pendingCallAction = null;
        }
        call.resolve(result);
    }

    @PluginMethod
    public void getPendingNotificationAction(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingNotificationAction != null) {
            result.put("event", pendingNotificationAction.getString("nativeNotificationEvent"));
            result.put("notificationId", pendingNotificationAction.getString("notificationId"));
            result.put("notificationType", pendingNotificationAction.getString("notificationType"));
            result.put("url", pendingNotificationAction.getString("url"));
            pendingNotificationAction = null;
        }
        call.resolve(result);
    }

    @PluginMethod
    public void stopIncomingCall(PluginCall call) {
        String callId = call.getString("callId");
        IncomingCallNotification.cancel(getContext(), callId);
        call.resolve();
    }

    private void registerDevice(PluginCall call, String supabaseUrl, String accessToken, String fcmToken) {
        HttpURLConnection connection = null;
        try {
            JSONObject payload = new JSONObject();
            payload.put("provider", "fcm");
            payload.put("token", fcmToken);
            payload.put("deviceIdentifier", DeviceIdentityStore.getInstallId(getContext()));
            payload.put("deviceSecret", DeviceIdentityStore.getDeviceSecret(getContext()));
            payload.put("platform", "android");
            payload.put("appVersion", BuildConfig.VERSION_NAME);

            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(supabaseUrl + "/functions/v1/register-call-device").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(12000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY);
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);

            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                call.reject("Unable to register call device.");
                return;
            }

            JSObject result = new JSObject();
            result.put("registered", true);
            result.put("provider", "fcm");
            call.resolve(result);
        } catch (Exception error) {
            Log.w(TAG, "Unable to register native call device", error);
            call.reject("Unable to register call device.", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
