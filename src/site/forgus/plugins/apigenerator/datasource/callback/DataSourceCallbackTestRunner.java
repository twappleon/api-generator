package site.forgus.plugins.apigenerator.datasource.callback;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Response;
import site.forgus.plugins.apigenerator.datasource.callback.client.OkHttpClientTest;
import site.forgus.plugins.apigenerator.datasource.callback.config.ApiConfig;
import site.forgus.plugins.apigenerator.datasource.callback.model.BalanceRequest;
import site.forgus.plugins.apigenerator.datasource.callback.model.BalanceResponse;
import site.forgus.plugins.apigenerator.util.JsonUtil;

import java.io.IOException;
import java.util.Scanner;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * DataSource Callback Test Runner
 * 数据源回调测试运行器
 * 
 * This class provides a comprehensive test suite for the Balance API
 * using OkHttpClient with various test scenarios.
 */
public class DataSourceCallbackTestRunner {
    
    private static final OkHttpClientTest clientTest = new OkHttpClientTest();
    
    public static void main(String[] args) {
        System.out.println("========================================");
        System.out.println("   DataSource Callback Test Runner");
        System.out.println("========================================");
        
        Scanner scanner = new Scanner(System.in);
        boolean running = true;
        
        while (running) {
            printMenu();
            int choice = scanner.nextInt();
            scanner.nextLine(); // Consume newline
            
            try {
                switch (choice) {
                    case 1:
                        testDefaultBalance();
                        break;
                    case 2:
                        testCustomBalance(scanner);
                        break;
                    case 3:
                        testOriginalFormat();
                        break;
                    case 4:
                        testAsyncBalance();
                        break;
                    case 5:
                        testWithRetry();
                        break;
                    case 6:
                        testBatchRequests();
                        break;
                    case 7:
                        testPerformance();
                        break;
                    case 8:
                        testErrorHandling();
                        break;
                    case 0:
                        running = false;
                        System.out.println("Exiting test runner...");
                        break;
                    default:
                        System.out.println("Invalid option. Please try again.");
                }
            } catch (Exception e) {
                System.err.println("Error occurred: " + e.getMessage());
                e.printStackTrace();
            }
            
            if (running) {
                System.out.println("\nPress Enter to continue...");
                scanner.nextLine();
            }
        }
        
        scanner.close();
        clientTest.close();
    }
    
    private static void printMenu() {
        System.out.println("\n========== Test Menu ==========");
        System.out.println("1. Test with default parameters");
        System.out.println("2. Test with custom parameters");
        System.out.println("3. Test with original format");
        System.out.println("4. Test async request");
        System.out.println("5. Test with retry mechanism");
        System.out.println("6. Test batch requests");
        System.out.println("7. Test performance");
        System.out.println("8. Test error handling");
        System.out.println("0. Exit");
        System.out.print("Select an option: ");
    }
    
    /**
     * Test 1: Default Balance Test
     */
    private static void testDefaultBalance() throws IOException {
        System.out.println("\n=== Testing with Default Parameters ===");
        
        BalanceResponse response = clientTest.testBalanceApiDefault();
        
        System.out.println("Test Result: " + (response.isSuccess() ? "SUCCESS" : "FAILED"));
        System.out.println("Response: " + response);
    }
    
    /**
     * Test 2: Custom Balance Test
     */
    private static void testCustomBalance(Scanner scanner) throws IOException {
        System.out.println("\n=== Testing with Custom Parameters ===");
        
        System.out.print("Enter Member Account (or press Enter for default): ");
        String account = scanner.nextLine();
        if (account.isEmpty()) {
            account = ApiConfig.TEST_MEMBER_ACCOUNT;
        }
        
        System.out.print("Enter Currency (or press Enter for VND): ");
        String currency = scanner.nextLine();
        if (currency.isEmpty()) {
            currency = ApiConfig.TEST_CURRENCY;
        }
        
        System.out.print("Enter Game ID (or press Enter for 22020): ");
        String gameIdStr = scanner.nextLine();
        int gameId = gameIdStr.isEmpty() ? ApiConfig.TEST_GAME_ID : Integer.parseInt(gameIdStr);
        
        BalanceRequest request = BalanceRequest.builder()
                .memberAccount(account)
                .currency(currency)
                .gameID(gameId)
                .ts(System.currentTimeMillis())
                .build();
        
        System.out.println("Sending request: " + request);
        
        BalanceResponse response = clientTest.testBalanceApi(request);
        System.out.println("Test Result: " + (response.isSuccess() ? "SUCCESS" : "FAILED"));
        System.out.println("Response: " + response);
    }
    
    /**
     * Test 3: Original Format Test
     */
    private static void testOriginalFormat() throws IOException {
        System.out.println("\n=== Testing with Original Format ===");
        
        String response = clientTest.testBalanceApiOriginalFormat();
        System.out.println("Raw Response: " + response);
        
        // Try to parse as BalanceResponse
        try {
            BalanceResponse balanceResponse = JsonUtil.fromJson(response, BalanceResponse.class);
            System.out.println("Parsed Response: " + balanceResponse);
            System.out.println("Test Result: " + (balanceResponse.isSuccess() ? "SUCCESS" : "FAILED"));
        } catch (Exception e) {
            System.err.println("Failed to parse response: " + e.getMessage());
        }
    }
    
    /**
     * Test 4: Async Balance Test
     */
    private static void testAsyncBalance() throws InterruptedException {
        System.out.println("\n=== Testing Async Request ===");
        
        CountDownLatch latch = new CountDownLatch(1);
        
        BalanceRequest request = BalanceRequest.builder()
                .memberAccount(ApiConfig.TEST_MEMBER_ACCOUNT)
                .currency(ApiConfig.TEST_CURRENCY)
                .gameID(ApiConfig.TEST_GAME_ID)
                .ts(System.currentTimeMillis())
                .build();
        
        clientTest.testBalanceApiAsync(request, new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                System.err.println("Async request failed: " + e.getMessage());
                e.printStackTrace();
                latch.countDown();
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.isSuccessful()) {
                    String responseBody = response.body() != null ? response.body().string() : "";
                    System.out.println("Async response received: " + responseBody);
                    
                    try {
                        BalanceResponse balanceResponse = JsonUtil.fromJson(responseBody, BalanceResponse.class);
                        System.out.println("Parsed Response: " + balanceResponse);
                        System.out.println("Test Result: " + (balanceResponse.isSuccess() ? "SUCCESS" : "FAILED"));
                    } catch (Exception e) {
                        System.err.println("Failed to parse response: " + e.getMessage());
                    }
                } else {
                    System.err.println("Async request failed with code: " + response.code());
                }
                response.close();
                latch.countDown();
            }
        });
        
        System.out.println("Waiting for async response...");
        latch.await(30, TimeUnit.SECONDS);
    }
    
    /**
     * Test 5: Retry Mechanism Test
     */
    private static void testWithRetry() throws IOException {
        System.out.println("\n=== Testing with Retry Mechanism ===");
        
        BalanceRequest request = BalanceRequest.builder()
                .memberAccount(ApiConfig.TEST_MEMBER_ACCOUNT)
                .currency(ApiConfig.TEST_CURRENCY)
                .gameID(ApiConfig.TEST_GAME_ID)
                .ts(System.currentTimeMillis())
                .build();
        
        System.out.println("Testing with max 3 retries...");
        
        try {
            BalanceResponse response = clientTest.testBalanceApiWithRetry(request, 3);
            System.out.println("Test Result: " + (response.isSuccess() ? "SUCCESS" : "FAILED"));
            System.out.println("Response: " + response);
        } catch (IOException e) {
            System.err.println("All retry attempts failed: " + e.getMessage());
        }
    }
    
    /**
     * Test 6: Batch Requests Test
     */
    private static void testBatchRequests() throws InterruptedException {
        System.out.println("\n=== Testing Batch Requests ===");
        
        int batchSize = 5;
        CountDownLatch latch = new CountDownLatch(batchSize);
        
        for (int i = 0; i < batchSize; i++) {
            final int requestId = i + 1;
            
            BalanceRequest request = BalanceRequest.builder()
                    .memberAccount(ApiConfig.TEST_MEMBER_ACCOUNT + "_" + requestId)
                    .currency(ApiConfig.TEST_CURRENCY)
                    .gameID(ApiConfig.TEST_GAME_ID)
                    .ts(System.currentTimeMillis())
                    .build();
            
            clientTest.testBalanceApiAsync(request, new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    System.err.println("Request " + requestId + " failed: " + e.getMessage());
                    latch.countDown();
                }
                
                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    System.out.println("Request " + requestId + " completed with code: " + response.code());
                    response.close();
                    latch.countDown();
                }
            });
        }
        
        System.out.println("Waiting for " + batchSize + " requests to complete...");
        latch.await(30, TimeUnit.SECONDS);
        System.out.println("Batch requests completed.");
    }
    
    /**
     * Test 7: Performance Test
     */
    private static void testPerformance() throws IOException {
        System.out.println("\n=== Testing Performance ===");
        
        int iterations = 10;
        long totalTime = 0;
        int successCount = 0;
        int failureCount = 0;
        
        BalanceRequest request = BalanceRequest.builder()
                .memberAccount(ApiConfig.TEST_MEMBER_ACCOUNT)
                .currency(ApiConfig.TEST_CURRENCY)
                .gameID(ApiConfig.TEST_GAME_ID)
                .ts(System.currentTimeMillis())
                .build();
        
        for (int i = 0; i < iterations; i++) {
            long startTime = System.currentTimeMillis();
            
            try {
                BalanceResponse response = clientTest.testBalanceApi(request);
                long endTime = System.currentTimeMillis();
                long duration = endTime - startTime;
                totalTime += duration;
                
                if (response.isSuccess()) {
                    successCount++;
                } else {
                    failureCount++;
                }
                
                System.out.println("Request " + (i + 1) + ": " + duration + "ms - " + 
                                 (response.isSuccess() ? "SUCCESS" : "FAILED"));
            } catch (IOException e) {
                failureCount++;
                System.err.println("Request " + (i + 1) + " failed: " + e.getMessage());
            }
        }
        
        System.out.println("\n=== Performance Summary ===");
        System.out.println("Total Requests: " + iterations);
        System.out.println("Successful: " + successCount);
        System.out.println("Failed: " + failureCount);
        System.out.println("Average Response Time: " + (totalTime / iterations) + "ms");
        System.out.println("Total Time: " + totalTime + "ms");
    }
    
    /**
     * Test 8: Error Handling Test
     */
    private static void testErrorHandling() {
        System.out.println("\n=== Testing Error Handling ===");
        
        // Test 1: Invalid URL
        System.out.println("\nTest 1: Invalid URL");
        try {
            BalanceRequest request = BalanceRequest.builder()
                    .memberAccount("invalid")
                    .currency("INVALID")
                    .gameID(-1)
                    .ts(0L)
                    .build();
            
            BalanceResponse response = clientTest.testBalanceApi(request);
            System.out.println("Response: " + response);
        } catch (Exception e) {
            System.out.println("Expected error caught: " + e.getMessage());
        }
        
        // Test 2: Null values
        System.out.println("\nTest 2: Null values");
        try {
            BalanceRequest request = new BalanceRequest();
            BalanceResponse response = clientTest.testBalanceApi(request);
            System.out.println("Response: " + response);
        } catch (Exception e) {
            System.out.println("Expected error caught: " + e.getMessage());
        }
        
        // Test 3: Empty request
        System.out.println("\nTest 3: Empty request");
        try {
            BalanceResponse response = clientTest.testBalanceApi(null);
            System.out.println("Response: " + response);
        } catch (Exception e) {
            System.out.println("Expected error caught: " + e.getMessage());
        }
        
        System.out.println("\nError handling tests completed.");
    }
}