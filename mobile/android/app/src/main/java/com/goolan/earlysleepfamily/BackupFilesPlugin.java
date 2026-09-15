package com.goolan.earlysleepfamily;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "BackupFiles")
public class BackupFilesPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String json = call.getString("json");
        String filename = call.getString("filename");
        if (json == null || filename == null) {
            call.reject("备份内容或文件名缺失");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.reject("已取消导出，本机备份仍保留");
            return;
        }
        String json = call.getString("json");
        if (json == null) {
            call.reject("备份内容已失效，请重试");
            return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new java.io.IOException("Cannot open destination");
            output.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception exception) {
            call.reject("备份文件写入失败，请重试", exception);
            return;
        }
        call.resolve();
    }
}
