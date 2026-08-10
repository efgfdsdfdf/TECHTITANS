package com.techtitans.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TechTitansCallPlugin.class);
        super.onCreate(savedInstanceState);
        captureNativeIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureNativeIntent(intent);
    }

    private void captureNativeIntent(Intent intent) {
        if (intent == null) return;
        if (intent.hasExtra("nativeCallEvent")) {
            TechTitansCallPlugin.setPendingCallAction(intent.getExtras());
        }
        if (intent.hasExtra("nativeNotificationEvent")) {
            TechTitansCallPlugin.setPendingNotificationAction(intent.getExtras());
        }
    }
}
