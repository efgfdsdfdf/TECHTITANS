package com.techtitans.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

final class IncomingCallNotification {
    private static final int BASE_NOTIFICATION_ID = 9100;
    private static final long CALL_TIMEOUT_MS = 60_000L;

    private IncomingCallNotification() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        Uri ringtone = android.provider.Settings.System.DEFAULT_RINGTONE_URI;
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        NotificationChannel channel = new NotificationChannel(
            TechTitansCallConstants.CHANNEL_ID,
            "Incoming calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("TechTitans voice and video call alerts");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] {0, 700, 300, 700, 300, 700});
        channel.setSound(ringtone, audioAttributes);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    static void show(Context context, Bundle call) {
        createChannel(context);

        String callId = call.getString(TechTitansCallConstants.EXTRA_CALL_ID, "");
        if (callId.isEmpty()) return;

        String callType = call.getString(TechTitansCallConstants.EXTRA_CALL_TYPE, "voice");
        String callerName = call.getString(TechTitansCallConstants.EXTRA_CALLER_NAME, "TechTitans");
        String title = "Incoming " + ("video".equals(callType) ? "video" : "voice") + " call";

        Intent openIntent = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtras(call)
            .putExtra("nativeCallEvent", "incoming");
        PendingIntent fullScreenIntent = PendingIntent.getActivity(
            context,
            requestCode(callId, 1),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent acceptIntent = actionIntent(context, call, TechTitansCallConstants.ACTION_ACCEPT, 2);
        PendingIntent declineIntent = actionIntent(context, call, TechTitansCallConstants.ACTION_DECLINE, 3);

        Notification notification = new NotificationCompat.Builder(context, TechTitansCallConstants.CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(callerName)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(CALL_TIMEOUT_MS)
            .setVibrate(new long[] {0, 700, 300, 700, 300, 700})
            .setSound(android.provider.Settings.System.DEFAULT_RINGTONE_URI)
            .setContentIntent(fullScreenIntent)
            .setFullScreenIntent(fullScreenIntent, true)
            .addAction(android.R.drawable.sym_call_incoming, "Accept", acceptIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declineIntent)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        NotificationManagerCompat.from(context).notify(notificationId(callId), notification);
    }

    static void cancel(Context context, String callId) {
        if (callId == null || callId.isEmpty()) return;
        NotificationManagerCompat.from(context).cancel(notificationId(callId));
    }

    private static PendingIntent actionIntent(Context context, Bundle call, String action, int salt) {
        Intent intent = new Intent(context, CallActionReceiver.class)
            .setAction(action)
            .putExtras(call);
        return PendingIntent.getBroadcast(
            context,
            requestCode(call.getString(TechTitansCallConstants.EXTRA_CALL_ID, ""), salt),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static int notificationId(String callId) {
        return BASE_NOTIFICATION_ID + Math.abs(callId.hashCode() % 10_000);
    }

    private static int requestCode(String callId, int salt) {
        return Math.abs((callId + ":" + salt + ":" + SystemClock.elapsedRealtime()).hashCode());
    }
}
