package site.forgus.plugins.apigenerator.datasource;

import okhttp3.*;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Balance API Callback Handler
 * 处理余额查询API的回调
 */
public class BalanceApiCallback {
    
    private static final String API_URL = "http://facai.hkpccfnewozt.xyz/tfghb/v1/api/balance";
    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json");
    
    private final OkHttpClient client;
    
    public BalanceApiCallback() {
        this.client = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();
    }
    
    /**
     * 异步调用余额查询API
     * @param memberAccount 会员账号
     * @param currency 货币类型
     * @param gameId 游戏ID
     * @param timestamp 时间戳
     * @return CompletableFuture<BalanceResponse>
     */
    public CompletableFuture<BalanceResponse> getBalanceAsync(String memberAccount, String currency, 
                                                            int gameId, long timestamp) {
        CompletableFuture<BalanceResponse> future = new CompletableFuture<>();
        
        // 构建请求体
        JsonObject requestBody = new JsonObject();
        requestBody.addProperty("MemberAccount", memberAccount);
        requestBody.addProperty("Currency", currency);
        requestBody.addProperty("GameID", gameId);
        requestBody.addProperty("Ts", timestamp);
        
        RequestBody body = RequestBody.create(JSON_MEDIA_TYPE, requestBody.toString());
        Request request = new Request.Builder()
                .url(API_URL)
                .post(body)
                .addHeader("Content-Type", "application/json")
                .build();
        
        // 异步执行请求
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                future.completeExceptionally(e);
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                try (ResponseBody responseBody = response.body()) {
                    if (response.isSuccessful() && responseBody != null) {
                        String responseString = responseBody.string();
                        BalanceResponse balanceResponse = parseResponse(responseString);
                        future.complete(balanceResponse);
                    } else {
                        future.completeExceptionally(new IOException("API call failed: " + response.code()));
                    }
                }
            }
        });
        
        return future;
    }
    
    /**
     * 同步调用余额查询API
     * @param memberAccount 会员账号
     * @param currency 货币类型
     * @param gameId 游戏ID
     * @param timestamp 时间戳
     * @return BalanceResponse
     * @throws IOException
     */
    public BalanceResponse getBalanceSync(String memberAccount, String currency, 
                                        int gameId, long timestamp) throws IOException {
        // 构建请求体
        JsonObject requestBody = new JsonObject();
        requestBody.addProperty("MemberAccount", memberAccount);
        requestBody.addProperty("Currency", currency);
        requestBody.addProperty("GameID", gameId);
        requestBody.addProperty("Ts", timestamp);
        
        RequestBody body = RequestBody.create(JSON_MEDIA_TYPE, requestBody.toString());
        Request request = new Request.Builder()
                .url(API_URL)
                .post(body)
                .addHeader("Content-Type", "application/json")
                .build();
        
        try (Response response = client.newCall(request).execute()) {
            if (response.isSuccessful() && response.body() != null) {
                String responseString = response.body().string();
                return parseResponse(responseString);
            } else {
                throw new IOException("API call failed: " + response.code());
            }
        }
    }
    
    /**
     * 解析API响应
     * @param responseString 响应字符串
     * @return BalanceResponse
     */
    private BalanceResponse parseResponse(String responseString) {
        try {
            JsonObject jsonResponse = JsonParser.parseString(responseString).getAsJsonObject();
            BalanceResponse response = new BalanceResponse();
            
            response.setSuccess(jsonResponse.has("success") ? jsonResponse.get("success").getAsBoolean() : false);
            response.setMessage(jsonResponse.has("message") ? jsonResponse.get("message").getAsString() : "");
            response.setBalance(jsonResponse.has("balance") ? jsonResponse.get("balance").getAsDouble() : 0.0);
            response.setCurrency(jsonResponse.has("currency") ? jsonResponse.get("currency").getAsString() : "");
            response.setMemberAccount(jsonResponse.has("memberAccount") ? jsonResponse.get("memberAccount").getAsString() : "");
            
            return response;
        } catch (Exception e) {
            BalanceResponse errorResponse = new BalanceResponse();
            errorResponse.setSuccess(false);
            errorResponse.setMessage("Failed to parse response: " + e.getMessage());
            return errorResponse;
        }
    }
    
    /**
     * 关闭客户端连接
     */
    public void close() {
        if (client != null) {
            client.dispatcher().executorService().shutdown();
            client.connectionPool().evictAll();
        }
    }
    
    /**
     * 余额响应数据类
     */
    public static class BalanceResponse {
        private boolean success;
        private String message;
        private double balance;
        private String currency;
        private String memberAccount;
        
        // Getters and Setters
        public boolean isSuccess() {
            return success;
        }
        
        public void setSuccess(boolean success) {
            this.success = success;
        }
        
        public String getMessage() {
            return message;
        }
        
        public void setMessage(String message) {
            this.message = message;
        }
        
        public double getBalance() {
            return balance;
        }
        
        public void setBalance(double balance) {
            this.balance = balance;
        }
        
        public String getCurrency() {
            return currency;
        }
        
        public void setCurrency(String currency) {
            this.currency = currency;
        }
        
        public String getMemberAccount() {
            return memberAccount;
        }
        
        public void setMemberAccount(String memberAccount) {
            this.memberAccount = memberAccount;
        }
        
        @Override
        public String toString() {
            return "BalanceResponse{" +
                    "success=" + success +
                    ", message='" + message + '\'' +
                    ", balance=" + balance +
                    ", currency='" + currency + '\'' +
                    ", memberAccount='" + memberAccount + '\'' +
                    '}';
        }
    }
}