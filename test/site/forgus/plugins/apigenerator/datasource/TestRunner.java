package site.forgus.plugins.apigenerator.datasource;

/**
 * 简单的测试运行器
 * 用于手动运行余额API测试，不依赖JUnit框架
 */
public class TestRunner {
    
    public static void main(String[] args) {
        System.out.println("=== 余额API调用可行性测试 ===");
        System.out.println();
        
        BalanceApiCallback balanceApiCallback = null;
        
        try {
            balanceApiCallback = new BalanceApiCallback();
            
            // 测试数据
            String memberAccount = "fcstwleon2025082727939968";
            String currency = "VND";
            int gameId = 22020;
            long timestamp = System.currentTimeMillis(); // 使用当前时间戳
            
            System.out.println("测试参数:");
            System.out.println("Member Account: " + memberAccount);
            System.out.println("Currency: " + currency);
            System.out.println("Game ID: " + gameId);
            System.out.println("Timestamp: " + timestamp);
            System.out.println();
            
            // 测试1: 同步调用
            System.out.println("--- 测试1: 同步API调用 ---");
            testSyncCall(balanceApiCallback, memberAccount, currency, gameId, timestamp);
            System.out.println();
            
            // 测试2: 异步调用
            System.out.println("--- 测试2: 异步API调用 ---");
            testAsyncCall(balanceApiCallback, memberAccount, currency, gameId, timestamp);
            System.out.println();
            
            // 测试3: 连通性测试
            System.out.println("--- 测试3: 连通性测试 ---");
            testConnectivity(balanceApiCallback, memberAccount, currency, gameId);
            System.out.println();
            
            System.out.println("=== 所有测试完成 ===");
            
        } catch (Exception e) {
            System.err.println("测试过程中发生错误: " + e.getMessage());
            e.printStackTrace();
        } finally {
            if (balanceApiCallback != null) {
                balanceApiCallback.close();
                System.out.println("资源已清理");
            }
        }
    }
    
    /**
     * 测试同步调用
     */
    private static void testSyncCall(BalanceApiCallback callback, String memberAccount, 
                                   String currency, int gameId, long timestamp) {
        try {
            long startTime = System.currentTimeMillis();
            
            BalanceApiCallback.BalanceResponse response = callback.getBalanceSync(
                memberAccount, currency, gameId, timestamp
            );
            
            long endTime = System.currentTimeMillis();
            long responseTime = endTime - startTime;
            
            System.out.println("✓ 同步调用成功");
            System.out.println("响应时间: " + responseTime + "ms");
            System.out.println("响应内容: " + response.toString());
            
        } catch (Exception e) {
            System.err.println("✗ 同步调用失败: " + e.getMessage());
        }
    }
    
    /**
     * 测试异步调用
     */
    private static void testAsyncCall(BalanceApiCallback callback, String memberAccount, 
                                    String currency, int gameId, long timestamp) {
        try {
            long startTime = System.currentTimeMillis();
            
            callback.getBalanceAsync(memberAccount, currency, gameId, timestamp)
                .thenAccept(response -> {
                    long endTime = System.currentTimeMillis();
                    long responseTime = endTime - startTime;
                    
                    System.out.println("✓ 异步调用成功");
                    System.out.println("响应时间: " + responseTime + "ms");
                    System.out.println("响应内容: " + response.toString());
                })
                .exceptionally(throwable -> {
                    System.err.println("✗ 异步调用失败: " + throwable.getMessage());
                    return null;
                })
                .join(); // 等待异步操作完成
                
        } catch (Exception e) {
            System.err.println("✗ 异步调用失败: " + e.getMessage());
        }
    }
    
    /**
     * 测试连通性
     */
    private static void testConnectivity(BalanceApiCallback callback, String memberAccount, 
                                       String currency, int gameId) {
        System.out.println("进行3次连通性测试...");
        
        int successCount = 0;
        int failureCount = 0;
        long totalTime = 0;
        
        for (int i = 1; i <= 3; i++) {
            System.out.print("测试 " + i + "/3... ");
            
            try {
                long startTime = System.currentTimeMillis();
                long currentTimestamp = System.currentTimeMillis();
                
                BalanceApiCallback.BalanceResponse response = callback.getBalanceSync(
                    memberAccount, currency, gameId, currentTimestamp
                );
                
                long endTime = System.currentTimeMillis();
                long responseTime = endTime - startTime;
                totalTime += responseTime;
                
                System.out.println("成功 (" + responseTime + "ms)");
                successCount++;
                
                // 避免过于频繁的请求
                Thread.sleep(2000);
                
            } catch (Exception e) {
                long endTime = System.currentTimeMillis();
                long responseTime = endTime - System.currentTimeMillis();
                totalTime += responseTime;
                
                System.out.println("失败 - " + e.getMessage());
                failureCount++;
                
                try {
                    Thread.sleep(2000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        
        System.out.println("连通性测试结果:");
        System.out.println("成功: " + successCount + "/3");
        System.out.println("失败: " + failureCount + "/3");
        if (successCount > 0) {
            System.out.println("平均响应时间: " + (totalTime / 3) + "ms");
        }
        
        if (successCount > 0) {
            System.out.println("✓ API连通性正常");
        } else {
            System.out.println("✗ API连通性存在问题");
        }
    }
}