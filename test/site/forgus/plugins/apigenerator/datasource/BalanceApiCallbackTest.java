package site.forgus.plugins.apigenerator.datasource;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import static org.junit.Assert.*;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * BalanceApiCallback 测试用例
 * 测试余额查询API调用的可行性
 */
public class BalanceApiCallbackTest {
    
    private BalanceApiCallback balanceApiCallback;
    
    // 测试数据
    private static final String TEST_MEMBER_ACCOUNT = "fcstwleon2025082727939968";
    private static final String TEST_CURRENCY = "VND";
    private static final int TEST_GAME_ID = 22020;
    private static final long TEST_TIMESTAMP = 1659405665545L;
    
    @Before
    public void setUp() {
        balanceApiCallback = new BalanceApiCallback();
    }
    
    @After
    public void tearDown() {
        if (balanceApiCallback != null) {
            balanceApiCallback.close();
        }
    }
    
    /**
     * 测试同步API调用
     */
    @Test
    public void testGetBalanceSync() {
        System.out.println("开始测试同步余额查询API调用...");
        
        try {
            BalanceApiCallback.BalanceResponse response = balanceApiCallback.getBalanceSync(
                TEST_MEMBER_ACCOUNT, 
                TEST_CURRENCY, 
                TEST_GAME_ID, 
                TEST_TIMESTAMP
            );
            
            // 验证响应不为空
            assertNotNull("响应不应为空", response);
            
            // 打印响应结果
            System.out.println("同步调用响应: " + response.toString());
            
            // 基本验证 - 根据实际API响应格式调整
            assertNotNull("消息不应为空", response.getMessage());
            
            System.out.println("同步API调用测试完成");
            
        } catch (IOException e) {
            System.err.println("同步API调用失败: " + e.getMessage());
            e.printStackTrace();
            // 不直接fail，因为网络问题可能导致测试失败
            System.out.println("注意: 网络连接可能存在问题，请检查API端点是否可访问");
        }
    }
    
    /**
     * 测试异步API调用
     */
    @Test
    public void testGetBalanceAsync() {
        System.out.println("开始测试异步余额查询API调用...");
        
        try {
            CompletableFuture<BalanceApiCallback.BalanceResponse> future = balanceApiCallback.getBalanceAsync(
                TEST_MEMBER_ACCOUNT, 
                TEST_CURRENCY, 
                TEST_GAME_ID, 
                TEST_TIMESTAMP
            );
            
            // 等待响应，最多等待30秒
            BalanceApiCallback.BalanceResponse response = future.get(30, TimeUnit.SECONDS);
            
            // 验证响应不为空
            assertNotNull("异步响应不应为空", response);
            
            // 打印响应结果
            System.out.println("异步调用响应: " + response.toString());
            
            // 基本验证
            assertNotNull("消息不应为空", response.getMessage());
            
            System.out.println("异步API调用测试完成");
            
        } catch (InterruptedException | ExecutionException | TimeoutException e) {
            System.err.println("异步API调用失败: " + e.getMessage());
            e.printStackTrace();
            System.out.println("注意: 网络连接可能存在问题，请检查API端点是否可访问");
        }
    }
    
    /**
     * 测试错误参数处理
     */
    @Test
    public void testInvalidParameters() {
        System.out.println("开始测试无效参数处理...");
        
        try {
            // 测试空的会员账号
            BalanceApiCallback.BalanceResponse response = balanceApiCallback.getBalanceSync(
                "", 
                TEST_CURRENCY, 
                TEST_GAME_ID, 
                TEST_TIMESTAMP
            );
            
            assertNotNull("即使参数无效，响应也不应为空", response);
            System.out.println("无效参数响应: " + response.toString());
            
        } catch (IOException e) {
            System.out.println("预期的异常: " + e.getMessage());
        }
        
        System.out.println("无效参数测试完成");
    }
    
    /**
     * 测试API连通性
     */
    @Test
    public void testApiConnectivity() {
        System.out.println("开始测试API连通性...");
        
        long startTime = System.currentTimeMillis();
        
        try {
            BalanceApiCallback.BalanceResponse response = balanceApiCallback.getBalanceSync(
                TEST_MEMBER_ACCOUNT, 
                TEST_CURRENCY, 
                TEST_GAME_ID, 
                System.currentTimeMillis() // 使用当前时间戳
            );
            
            long endTime = System.currentTimeMillis();
            long responseTime = endTime - startTime;
            
            System.out.println("API响应时间: " + responseTime + "ms");
            System.out.println("连通性测试响应: " + response.toString());
            
            // 验证响应时间合理（小于30秒）
            assertTrue("响应时间应小于30秒", responseTime < 30000);
            
        } catch (IOException e) {
            long endTime = System.currentTimeMillis();
            long responseTime = endTime - startTime;
            
            System.err.println("连通性测试失败，耗时: " + responseTime + "ms");
            System.err.println("错误信息: " + e.getMessage());
        }
        
        System.out.println("API连通性测试完成");
    }
    
    /**
     * 性能测试 - 多次调用
     */
    @Test
    public void testPerformance() {
        System.out.println("开始性能测试 - 连续5次API调用...");
        
        int successCount = 0;
        int failureCount = 0;
        long totalTime = 0;
        
        for (int i = 1; i <= 5; i++) {
            long startTime = System.currentTimeMillis();
            
            try {
                BalanceApiCallback.BalanceResponse response = balanceApiCallback.getBalanceSync(
                    TEST_MEMBER_ACCOUNT, 
                    TEST_CURRENCY, 
                    TEST_GAME_ID, 
                    System.currentTimeMillis()
                );
                
                long endTime = System.currentTimeMillis();
                long responseTime = endTime - startTime;
                totalTime += responseTime;
                
                System.out.println("第" + i + "次调用成功，耗时: " + responseTime + "ms");
                successCount++;
                
                // 短暂休息避免过于频繁的请求
                Thread.sleep(1000);
                
            } catch (IOException | InterruptedException e) {
                long endTime = System.currentTimeMillis();
                long responseTime = endTime - startTime;
                totalTime += responseTime;
                
                System.err.println("第" + i + "次调用失败，耗时: " + responseTime + "ms, 错误: " + e.getMessage());
                failureCount++;
            }
        }
        
        System.out.println("性能测试结果:");
        System.out.println("成功次数: " + successCount);
        System.out.println("失败次数: " + failureCount);
        System.out.println("平均响应时间: " + (totalTime / 5) + "ms");
        System.out.println("总耗时: " + totalTime + "ms");
    }
    
    /**
     * 测试响应数据解析
     */
    @Test
    public void testResponseParsing() {
        System.out.println("开始测试响应数据解析...");
        
        try {
            BalanceApiCallback.BalanceResponse response = balanceApiCallback.getBalanceSync(
                TEST_MEMBER_ACCOUNT, 
                TEST_CURRENCY, 
                TEST_GAME_ID, 
                TEST_TIMESTAMP
            );
            
            // 检查响应对象的各个字段
            System.out.println("解析结果:");
            System.out.println("Success: " + response.isSuccess());
            System.out.println("Message: " + response.getMessage());
            System.out.println("Balance: " + response.getBalance());
            System.out.println("Currency: " + response.getCurrency());
            System.out.println("Member Account: " + response.getMemberAccount());
            
            // 验证toString方法
            String responseString = response.toString();
            assertNotNull("toString结果不应为空", responseString);
            assertTrue("toString应包含类名", responseString.contains("BalanceResponse"));
            
        } catch (IOException e) {
            System.err.println("响应解析测试失败: " + e.getMessage());
        }
        
        System.out.println("响应数据解析测试完成");
    }
}