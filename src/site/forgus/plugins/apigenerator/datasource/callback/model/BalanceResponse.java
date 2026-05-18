package site.forgus.plugins.apigenerator.datasource.callback.model;

import java.io.Serializable;

/**
 * Balance API Response Model
 * 余额查询响应模型
 */
public class BalanceResponse implements Serializable {
    
    private static final long serialVersionUID = 1L;
    
    /**
     * 响应码
     */
    private Integer code;
    
    /**
     * 响应消息
     */
    private String message;
    
    /**
     * 余额数据
     */
    private BalanceData data;
    
    /**
     * 时间戳
     */
    private Long timestamp;
    
    public static class BalanceData {
        /**
         * 账户余额
         */
        private Double balance;
        
        /**
         * 货币类型
         */
        private String currency;
        
        /**
         * 会员账号
         */
        private String memberAccount;
        
        /**
         * 更新时间
         */
        private Long updateTime;
        
        // Getters and Setters
        public Double getBalance() {
            return balance;
        }
        
        public void setBalance(Double balance) {
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
        
        public Long getUpdateTime() {
            return updateTime;
        }
        
        public void setUpdateTime(Long updateTime) {
            this.updateTime = updateTime;
        }
        
        @Override
        public String toString() {
            return "BalanceData{" +
                    "balance=" + balance +
                    ", currency='" + currency + '\'' +
                    ", memberAccount='" + memberAccount + '\'' +
                    ", updateTime=" + updateTime +
                    '}';
        }
    }
    
    // Getters and Setters
    public Integer getCode() {
        return code;
    }
    
    public void setCode(Integer code) {
        this.code = code;
    }
    
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
    
    public BalanceData getData() {
        return data;
    }
    
    public void setData(BalanceData data) {
        this.data = data;
    }
    
    public Long getTimestamp() {
        return timestamp;
    }
    
    public void setTimestamp(Long timestamp) {
        this.timestamp = timestamp;
    }
    
    public boolean isSuccess() {
        return code != null && code == 200;
    }
    
    @Override
    public String toString() {
        return "BalanceResponse{" +
                "code=" + code +
                ", message='" + message + '\'' +
                ", data=" + data +
                ", timestamp=" + timestamp +
                '}';
    }
}