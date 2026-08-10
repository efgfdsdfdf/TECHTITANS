package com.techtitans.app;

final class TechTitansCallConstants {
    static final String SUPABASE_URL = "https://mdqqtsdibtvymfgntstf.supabase.co";
    static final String REGISTER_CALL_DEVICE_URL = SUPABASE_URL + "/functions/v1/register-call-device";
    static final String CALL_DEVICE_ACTION_URL = SUPABASE_URL + "/functions/v1/call-device-action";
    static final String CHANNEL_ID = "incoming_calls";
    static final String NOTIFICATION_CHANNEL_ID = "techtitans_notifications";
    static final String ACTION_ACCEPT = "com.techtitans.app.ACCEPT_CALL";
    static final String ACTION_DECLINE = "com.techtitans.app.DECLINE_CALL";
    static final String EXTRA_CALL_ID = "callId";
    static final String EXTRA_CALL_TYPE = "callType";
    static final String EXTRA_ROOM_ID = "roomId";
    static final String EXTRA_CALLER_ID = "callerId";
    static final String EXTRA_CALLER_NAME = "callerName";

    private TechTitansCallConstants() {}
}
