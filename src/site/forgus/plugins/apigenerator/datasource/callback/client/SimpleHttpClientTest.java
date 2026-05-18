package site.forgus.plugins.apigenerator.datasource.callback.client;

import site.forgus.plugins.apigenerator.datasource.callback.config.ApiConfig;
import site.forgus.plugins.apigenerator.datasource.callback.model.BalanceRequest;
import site.forgus.plugins.apigenerator.datasource.callback.model.BalanceResponse;
import site.forgus.plugins.apigenerator.util.HttpUtil;
import site.forgus.plugins.apigenerator.util.JsonUtil;

import java.io.IOException;

/**
 * Simple HTTP Client Test using existing HttpUtil
 * 使用现有HttpUtil的简单HTTP客户端测试
 * 
 * This class provides a simpler alternative that uses the existing HttpUtil
 * without requiring external OkHttp dependencies.
 */
public class SimpleHttpClientTest {
    
    /**
     * Test balance API with default parameters using HttpUtil
     */
    public BalanceResponse testBalanceApiDefault() throws IOException {
        BalanceRequest request = BalanceRequest.builder()
                .memberAccount(ApiConfig.TEST_MEMBER_ACCOUNT)
                .currency(ApiConfig.TEST_CURRENCY)
                .gameID(ApiConfig.TEST_GAME_ID)
                .ts(ApiConfig.getCurrentTimestamp())
                .build();
        
        return testBalanceApi(request);
    }
    
    /**
     * Test balance API with custom request using HttpUtil
     */
    public BalanceResponse testBalanceApi(BalanceRequest balanceRequest) throws IOException {
        // Convert request object to JSON
        String jsonRequest = JsonUtil.toJson(balanceRequest);
        System.out.println("Request JSON: " + jsonRequest);
        System.out.println("Request URL: " + ApiConfig.getBalanceUrl());
        
        // Send POST request using HttpUtil
        long startTime = System.currentTimeMillis();
        String responseBody = HttpUtil.doPost(ApiConfig.getBalanceUrl(), jsonRequest);
        long endTime = System.currentTimeMillis();
        
        System.out.println("Response Time: " + (endTime - startTime) + "ms");
        System.out.println("Response Body: " + responseBody);
        
        // Convert JSON to response object
        BalanceResponse balanceResponse = JsonUtil.fromJson(responseBody, BalanceResponse.class);
        
        // Log response details
        logResponse(balanceResponse);
        
        return balanceResponse;
    }
    
    /**
     * Test balance API with original format
     */
    public String testBalanceApiOriginalFormat() throws IOException {
        // Using the exact format from the requirement
        String jsonRequest = "{\n" +
                "  \"MemberAccount\": \"fcstwleon2025082727939968\",\n" +
                "  \"Currency\": \"VND\",\n" +
                "  \"GameID\": 22020,\n" +
                "  \"Ts\": " + System.currentTimeMillis() + "\n" +
                "}";
        
        System.out.println("Original Format Request: " + jsonRequest);
        
        String responseBody = HttpUtil.doPost(ApiConfig.getBalanceUrl(), jsonRequest);
        System.out.println("Original Format Response: " + responseBody);
        
        return responseBody;
    }
    
    /**
     * Test with retry mechanism
     */
    public BalanceResponse testBalanceApiWithRetry(BalanceRequest balanceRequest, int maxRetries) 
            throws IOException {
        IOException lastException = null;
        
        for (int i = 0; i <= maxRetries; i++) {
            try {
                System.out.println("Attempt " + (i + 1) + " of " + (maxRetries + 1));
                return testBalanceApi(balanceRequest);
            } catch (IOException e) {
                lastException = e;
                System.err.println("Request failed on attempt " + (i + 1) + ": " + e.getMessage());
                
                if (i < maxRetries) {
                    try {
                        Thread.sleep(1000 * (i + 1)); // Exponential backoff
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new IOException("Interrupted during retry", ie);
                    }
                }
            }
        }
        
        throw new IOException("All retry attempts failed", lastException);
    }
    
    /**
     * Log response details
     */
    private void logResponse(BalanceResponse balanceResponse) {
        System.out.println("=== Response Details ===");
        
        if (balanceResponse != null) {
            System.out.println("Response Code: " + balanceResponse.getCode());
            System.out.println("Response Message: " + balanceResponse.getMessage());
            System.out.println("Is Success: " + balanceResponse.isSuccess());
            System.out.println("Timestamp: " + balanceResponse.getTimestamp());
            
            if (balanceResponse.getData() != null) {
                System.out.println("Balance Data: " + balanceResponse.getData());
            }
        }
        System.out.println("========================");
    }
    
    /**
     * Main method for standalone testing
     */
    public static void main(String[] args) {
        SimpleHttpClientTest test = new SimpleHttpClientTest();
        
        System.out.println("========================================");
        System.out.println("  Simple HTTP Client Test for Balance API");
        System.out.println("========================================\n");
        
        try {
            // Test 1: Default parameters
            System.out.println("Test 1: Testing with default parameters");
            System.out.println("----------------------------------------");
            BalanceResponse response1 = test.testBalanceApiDefault();
            System.out.println("Test 1 Result: " + (response1.isSuccess() ? "SUCCESS" : "FAILED"));
            System.out.println();
            
            // Test 2: Custom parameters
            System.out.println("Test 2: Testing with custom parameters");
            System.out.println("----------------------------------------");
            BalanceRequest customRequest = BalanceRequest.builder()
                    .memberAccount("testuser123")
                    .currency("USD")
                    .gameID(12345)
                    .ts(System.currentTimeMillis())
                    .build();
            BalanceResponse response2 = test.testBalanceApi(customRequest);
            System.out.println("Test 2 Result: " + (response2.isSuccess() ? "SUCCESS" : "FAILED"));
            System.out.println();
            
            // Test 3: Original format
            System.out.println("Test 3: Testing with original format");
            System.out.println("----------------------------------------");
            String response3 = test.testBalanceApiOriginalFormat();
            System.out.println("Test 3 Completed");
            System.out.println();
            
            // Test 4: With retry
            System.out.println("Test 4: Testing with retry mechanism (max 2 retries)");
            System.out.println("----------------------------------------");
            BalanceResponse response4 = test.testBalanceApiWithRetry(
                    BalanceRequest.builder()
                            .memberAccount(ApiConfig.TEST_MEMBER_ACCOUNT)
                            .currency(ApiConfig.TEST_CURRENCY)
                            .gameID(ApiConfig.TEST_GAME_ID)
                            .ts(System.currentTimeMillis())
                            .build(),
                    2
            );
            System.out.println("Test 4 Result: " + (response4.isSuccess() ? "SUCCESS" : "FAILED"));
            
        } catch (IOException e) {
            System.err.println("Test failed with error: " + e.getMessage());
            e.printStackTrace();
        }
        
        System.out.println("\n========================================");
        System.out.println("  All tests completed");
        System.out.println("========================================");
    }
}