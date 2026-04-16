// Stub: OAuth types for external builds (Klaus does not use claude.ai OAuth)

export type SubscriptionType = 'free' | 'pro' | 'team' | 'enterprise' | 'max_5' | 'max_20' | string

export type BillingType = 'self_serve' | 'invoiced' | 'stripe' | string

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  subscriptionType?: SubscriptionType | null
  scopes?: string[]
  rateLimitTier?: RateLimitTier | null
  profile?: OAuthProfileResponse
  tokenAccount?: {
    uuid?: string
    emailAddress?: string
    organizationUuid?: string
  }
}

export type RateLimitTier = string

export interface OAuthProfileResponse {
  id: string
  email: string
  name?: string
  account?: {
    uuid: string
    email: string
    display_name?: string
    created_at?: string
  }
  organization?: {
    uuid: string
    name?: string
    organization_type?: string
    rate_limit_tier?: RateLimitTier | null
    has_extra_usage_enabled?: boolean
    billing_type?: BillingType | null
    subscription_created_at?: string
  }
}

export interface OAuthTokenExchangeResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type?: string
  scope?: string
  account?: {
    uuid?: string
    email_address?: string
    display_name?: string
    organization?: {
      uuid?: string
      name?: string
    }
  }
  organization?: {
    uuid?: string
    name?: string
  }
}

export interface ReferralEligibilityResponse {
  isEligible: boolean
  referralCode?: string
  eligible?: boolean
  referrer_reward?: unknown
  remaining_passes?: number
}

export type ReferralCampaign = 'claude_code_guest_pass' | string

export interface ReferralRedemptionsResponse {
  redemptions: unknown[]
  total?: number
}

export interface ReferrerRewardInfo {
  currency: string
  amount_minor_units: number
}

export interface UserRolesResponse {
  roles?: string[]
  [key: string]: unknown
}
