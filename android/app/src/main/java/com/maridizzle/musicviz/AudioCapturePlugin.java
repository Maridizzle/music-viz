package com.maridizzle.musicviz;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Arrays;

/**
 * JS ⇄ native bridge for system-audio capture. `start()` asks for the microphone
 * permission (AudioRecord needs it even for playback capture), then the screen
 * capture consent, then runs CaptureService which streams PCM back as "pcm"
 * events (base64 16-bit mono). "stopped" fires when the capture ends.
 */
@CapacitorPlugin(
    name = "AudioCapture",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "audio") }
)
public class AudioCapturePlugin extends Plugin implements CaptureService.Sink {
    private int sampleRate = 48000;
    private PluginCall pendingStart;

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("System audio capture needs Android 10 or newer.");
            return;
        }
        sampleRate = call.getInt("sampleRate", 48000);
        if (getPermissionState("audio") != PermissionState.GRANTED) {
            requestPermissionForAlias("audio", call, "audioPermissionCallback");
            return;
        }
        requestProjection(call);
    }

    @PermissionCallback
    private void audioPermissionCallback(PluginCall call) {
        if (getPermissionState("audio") == PermissionState.GRANTED) {
            requestProjection(call);
        } else {
            call.reject("Microphone permission is required to capture audio.");
        }
    }

    private void requestProjection(PluginCall call) {
        MediaProjectionManager mpm =
            (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, mpm.createScreenCaptureIntent(), "projectionResult");
    }

    @ActivityCallback
    private void projectionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Screen-capture permission was denied.");
            return;
        }
        pendingStart = call;
        CaptureService.sink = this;
        CaptureService.start(getContext(), result.getResultCode(), result.getData(), sampleRate);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        CaptureService.stop(getContext());
        call.resolve();
    }

    // ---- CaptureService.Sink (called from service threads) ----

    @Override
    public void onStarted(int rate) {
        PluginCall call = pendingStart;
        pendingStart = null;
        if (call != null) {
            JSObject ret = new JSObject();
            ret.put("sampleRate", rate);
            call.resolve(ret);
        }
    }

    @Override
    public void onPcm(byte[] data, int length) {
        JSObject ev = new JSObject();
        ev.put("data", Base64.encodeToString(Arrays.copyOf(data, length), Base64.NO_WRAP));
        notifyListeners("pcm", ev);
    }

    @Override
    public void onStopped(String reason) {
        PluginCall call = pendingStart;
        pendingStart = null;
        if (call != null) call.reject(reason);
        if (CaptureService.sink == this) CaptureService.sink = null;
        JSObject ev = new JSObject();
        ev.put("reason", reason);
        notifyListeners("stopped", ev);
    }
}
