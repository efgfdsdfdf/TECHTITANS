package com.techtitans.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.Map;

final class TechTitansNotificationCenter {
    private static final int BASE_NOTIFICATION_ID = 19000;

    private TechTitansNotificationCenter() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
            TechTitansCallConstants.NOTIFICATION_CHANNEL_ID,
            "TechTitans notifications",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Messages, announcements, resources, requests, and system notifications");
        channel.enableVibration(true);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    static void show(Context context, Map<String, String> data) {
        createChannel(context);

        String type = value(data, "type", "system");
        String notificationId = value(data, "notificationId", String.valueOf(System.currentTimeMillis()));
        String title = value(data, "title", "TechTitans");
        String body = value(data, "body", "New activity");
        String url = routeFor(data);

        Intent openIntent = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("nativeNotificationEvent", "notificationOpened")
            .putExtra("notificationType", type)
            .putExtra("notificationId", notificationId)
            .putExtra("url", url);

        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, TechTitansCallConstants.NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        NotificationManagerCompat.from(context).notify(BASE_NOTIFICATION_ID + Math.abs(notificationId.hashCode() % 10000), builder.build());
    }

    private static String routeFor(Map<String, String> data) {
        String url = data.get("url");
        if (url != null && !url.isEmpty()) return url;

        String type = value(data, "type", "system");
        if ("message".equals(type)) {
            String conversationId = data.get("conversationId");
            if (conversationId != null && !conversationId.isEmpty()) return "dm.html?user=" + conversationId;
            return "dm.html";
        }
        if ("announcement".equals(type)) return "dashboard.html";
        if ("resource".equals(type)) return "resources.html";
        return "dashboard.html";
    }

    private static String value(Map<String, String> data, String key, String fallback) {
        String value = data.get(key);
        return value == null || value.isEmpty() ? fallback : value;
    }
}
