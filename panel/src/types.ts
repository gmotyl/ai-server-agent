export interface Topic {
  id: string
  label: string
  active: boolean
  archived: boolean
  provider: string
  messageCount: number
  lastActivity: string | null
  scheduleName: string | null
}

export interface Schedule {
  name: string
  cron: string
  prompt: string
  provider: string | null
  workdir: string
  topic_name: string
  lastRun: string | null
}

export interface Message {
  ts: string
  from: string
  text: string
}

export interface Status {
  defaultProvider: string
  topicCount: number
  scheduleCount: number
  pollTimeout: number
  providers: string[]
}

export interface ProviderDetail {
  name: string
  dispatcher: string
  extra: string
  custom: boolean
  preconfigured: boolean
  warning: string | null
  command: string
}

export interface ProvidersResponse {
  providers: ProviderDetail[]
  preconfiguredDispatchers: string[]
}
