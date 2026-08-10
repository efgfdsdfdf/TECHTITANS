package com.techtitans.app;

import android.os.Bundle;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class TechTitansMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        DeviceIdentityStore.saveFcmToken(this, token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        String type = data.get("type");
        String callId = data.get("callId");

        if ("call_cancelled".equals(type)) {
            IncomingCallNotification.cancel(this, callId);
            return;
        }

        if (!"incoming_call".equals(type)) {
            TechTitansNotificationCenter.show(this, data);
            return;
        }

        if (callId == null || callId.isEmpty()) return;

        Bundle call = new Bundle();
        call.putString(TechTitansCallConstants.EXTRA_CALL_ID, callId);
        call.putString(TechTitansCallConstants.EXTRA_CALL_TYPE, data.get("callType"));
        call.putString(TechTitansCallConstants.EXTRA_ROOM_ID, data.get("roomId"));
        call.putString(TechTitansCallConstants.EXTRA_CALLER_ID, data.get("callerId"));
        call.putString(TechTitansCallConstants.EXTRA_CALLER_NAME, data.getOrDefault("callerName", "TechTitans"));
        IncomingCallNotification.show(this, call);
    }
}
