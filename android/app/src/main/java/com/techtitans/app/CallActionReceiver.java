package com.techtitans.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String callId = intent.getStringExtra(TechTitansCallConstants.EXTRA_CALL_ID);
        if (callId == null || callId.isEmpty()) return;

        IncomingCallNotification.cancel(context, callId);

        String action = TechTitansCallConstants.ACTION_ACCEPT.equals(intent.getAction()) ? "accept" : "decline";
        new Thread(() -> CallActionClient.sendDeviceAction(context, callId, action)).start();

        if ("accept".equals(action)) {
            Intent launch = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtras(intent)
                .putExtra("nativeCallEvent", "incomingCallAccepted");
            context.startActivity(launch);
        }
    }
}
