package site.forgus.plugins.apigenerator.datasource.callback.model;

import java.io.Serializable;

/**
 * Balance API Request Model
 * 余额查询请求模型
 */
public class BalanceRequest implements Serializable {
    
    private static final long serialVersionUID = 1L;
    
    /**
     * 会员账号
     */
    private String MemberAccount;
    
    /**
     * 货币类型
     */
    private String Currency;
    
    /**
     * 游戏ID
     */
    private Integer GameID;
    
    /**
     * 时间戳
     */
    private Long Ts;
    
    public BalanceRequest() {
    }
    
    public BalanceRequest(String memberAccount, String currency, Integer gameID, Long ts) {
        this.MemberAccount = memberAccount;
        this.Currency = currency;
        this.GameID = gameID;
        this.Ts = ts;
    }
    
    // Builder pattern for easy construction
    public static Builder builder() {
        return new Builder();
    }
    
    public static class Builder {
        private String memberAccount;
        private String currency;
        private Integer gameID;
        private Long ts;
        
        public Builder memberAccount(String memberAccount) {
            this.memberAccount = memberAccount;
            return this;
        }
        
        public Builder currency(String currency) {
            this.currency = currency;
            return this;
        }
        
        public Builder gameID(Integer gameID) {
            this.gameID = gameID;
            return this;
        }
        
        public Builder ts(Long ts) {
            this.ts = ts;
            return this;
        }
        
        public BalanceRequest build() {
            return new BalanceRequest(memberAccount, currency, gameID, ts);
        }
    }
    
    // Getters and Setters
    public String getMemberAccount() {
        return MemberAccount;
    }
    
    public void setMemberAccount(String memberAccount) {
        this.MemberAccount = memberAccount;
    }
    
    public String getCurrency() {
        return Currency;
    }
    
    public void setCurrency(String currency) {
        this.Currency = currency;
    }
    
    public Integer getGameID() {
        return GameID;
    }
    
    public void setGameID(Integer gameID) {
        this.GameID = gameID;
    }
    
    public Long getTs() {
        return Ts;
    }
    
    public void setTs(Long ts) {
        this.Ts = ts;
    }
    
    @Override
    public String toString() {
        return "BalanceRequest{" +
                "MemberAccount='" + MemberAccount + '\'' +
                ", Currency='" + Currency + '\'' +
                ", GameID=" + GameID +
                ", Ts=" + Ts +
                '}';
    }
}