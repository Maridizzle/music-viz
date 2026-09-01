package com.maridizzle.musicviz;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Foreground service (type mediaProjection — mandatory on Android 14+) that owns the
 * MediaProjection and an AudioRecord configured for AudioPlaybackCapture, i.e. the
 * audio other apps are playing. PCM chunks are handed to the registered Sink
 * (the Capacitor plugin), which forwards them to the WebView.
 */
public class CaptureService extends Service {
    private static final String TAG = "MVCapture";
    private static final String CHANNEL_ID = "musicviz_capture";
    private static final int NOTIFICATION_ID = 4711;

    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_RESULT_DATA = "resultData";
    static final String EXTRA_SAMPLE_RATE = "sampleRate";

    public interface Sink {
        void onStarted(int sampleRate);
        void onPcm(byte[] data, int length);
        void onStopped(String reason);
    }

    /** Set by the plugin before the service starts; cleared when it stops. */
    static volatile Sink sink;

    private MediaProjection projection;
    private AudioRecord record;
    private Thread reader;
    private volatile boolean running;
    private boolean announcedStop;

    static void start(Context ctx, int resultCode, Intent resultData, int sampleRate) {
        Intent i = new Intent(ctx, CaptureService.class);
        i.putExtra(EXTRA_RESULT_CODE, resultCode);
        i.putExtra(EXTRA_RESULT_DATA, resultData);
        i.putExtra(EXTRA_SAMPLE_RATE, sampleRate);
        ContextCompat.startForegroundService(ctx, i);
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, CaptureService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startAsForeground();

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        int sampleRate = intent.getIntExtra(EXTRA_SAMPLE_RATE, 48000);
        if (resultData == null) {
            fail("Missing capture permission result");
            return START_NOT_STICKY;
        }
        try {
            beginCapture(resultCode, resultData, sampleRate);
        } catch (Exception e) {
            Log.e(TAG, "capture failed", e);
            fail("Could not start audio capture: " + e.getMessage());
        }
        return START_NOT_STICKY;
    }

    private void startAsForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Audio capture", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while the visualizer is capturing system audio");
            nm.createNotificationChannel(ch);
        }
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Music Visualizer")
            .setContentText("Reacting to your system audio")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void beginCapture(int resultCode, Intent resultData, int sampleRate) {
        MediaProjectionManager mpm =
            (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        projection = mpm.getMediaProjection(resultCode, resultData);
        if (projection == null) {
            fail("Capture permission was not granted");
            return;
        }
        // Android 14+ requires a callback to be registered before the projection is used.
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                Log.i(TAG, "projection stopped by system/user");
                shutdown("Capture was stopped");
            }
        }, new Handler(Looper.getMainLooper()));

        AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build();
        AudioFormat format = new AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(sampleRate)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build();
        int min = AudioRecord.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int bufferSize = Math.max(min * 2, 16384);
        record = new AudioRecord.Builder()
            .setAudioFormat(format)
            .setBufferSizeInBytes(bufferSize)
            .setAudioPlaybackCaptureConfig(cfg)
            .build();
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
            fail("AudioRecord could not be initialised");
            return;
        }
        record.startRecording();
        running = true;

        final int rate = sampleRate;
        reader = new Thread(() -> {
            byte[] buf = new byte[4096]; // 2048 samples ≈ 43 ms at 48 kHz
            while (running) {
                int n = record.read(buf, 0, buf.length, AudioRecord.READ_BLOCKING);
                if (n > 0) {
                    Sink s = sink;
                    if (s != null) s.onPcm(buf, n);
                } else if (n < 0) {
                    Log.w(TAG, "AudioRecord.read returned " + n);
                    break;
                }
            }
        }, "mv-capture-reader");
        reader.setDaemon(true);
        reader.start();

        Sink s = sink;
        if (s != null) s.onStarted(rate);
        Log.i(TAG, "capture started @" + rate + " Hz");
    }

    private void fail(String reason) {
        shutdown(reason);
    }

    private void shutdown(String reason) {
        running = false;
        if (record != null) {
            try {
                record.stop();
            } catch (Exception ignored) { }
            record.release();
            record = null;
        }
        if (projection != null) {
            try {
                projection.stop();
            } catch (Exception ignored) { }
            projection = null;
        }
        if (!announcedStop) {
            announcedStop = true;
            Sink s = sink;
            if (s != null) s.onStopped(reason);
        }
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        shutdown("Service destroyed");
        super.onDestroy();
    }
}
