package site.forgus.plugins.apigenerator.datasource.callback.config;

/**
 * API Configuration
 * API配置类
 */
public class ApiConfig {
    
    /**
     * Base URL for the API
     */
    public static final String BASE_URL = "http://facai.hkpccfnewozt.xyz";
    
    /**
     * Balance API endpoint
     */
    public static final String BALANCE_ENDPOINT = "/tfghb/v1/api/balance";
    
    /**
     * Connection timeout in milliseconds
     */
    public static final int CONNECTION_TIMEOUT = 10000;
    
    /**
     * Read timeout in milliseconds
     */
    public static final int READ_TIMEOUT = 10000;
    
    /**
     * Write timeout in milliseconds
     */
    public static final int WRITE_TIMEOUT = 10000;
    
    /**
     * Default content type
     */
    public static final String CONTENT_TYPE_JSON = "application/json";
    
    /**
     * Default charset
     */
    public static final String CHARSET_UTF8 = "UTF-8";
    
    /**
     * Test member account
     */
    public static final String TEST_MEMBER_ACCOUNT = "fcstwleon2025082727939968";
    
    /**
     * Test currency
     */
    public static final String TEST_CURRENCY = "VND";
    
    /**
     * Test game ID
     */
    public static final int TEST_GAME_ID = 22020;
    
    /**
     * Get full URL for balance endpoint
     */
    public static String getBalanceUrl() {
        return BASE_URL + BALANCE_ENDPOINT;
    }
    
    /**
     * Get current timestamp
     */
    public static long getCurrentTimestamp() {
        return System.currentTimeMillis();
    }
}