# Steps and Triggers Not Implementing

This document lists workflow steps and triggers that are intentionally **not** being implemented in the core plugin. These are either better suited as custom user implementations or fall outside the plugin's scope.

## Steps Not Implementing

### Workflow Orchestration
- **Stop Workflow** - Can be achieved through conditional logic
- **Run Workflow** - Adds complexity to execution tracking and circular dependency management
- **Parallel Fork/Join** - Current dependency system already enables parallel execution

### External Service Integrations
- **GraphQL Query** - Better as custom HTTP request step
- **S3/Cloud Storage** - Too provider-specific
- **Message Queue** (Kafka, RabbitMQ, SQS) - Infrastructure-specific
- **SMS** (Twilio, etc.) - Requires external accounts
- **Push Notifications** - Platform-specific implementation
- **Slack/Discord/Teams** - Better as custom HTTP webhooks
- **Calendar Integration** - Too many providers to support

### AI/ML Operations
- **AI Prompt** (OpenAI, Claude, etc.) - Requires API keys, better as custom implementation
- **Text Analysis** - Too many variations and providers
- **Image Processing** - Better handled by dedicated services

### Specialized Data Operations
- **Database Query** (Direct SQL/NoSQL) - Security concerns, bypasses Payload
- **File Operations** - Complex permission and security implications
- **Hash/Encrypt** - Security-sensitive, needs careful implementation
- **RSS/Feed Processing** - Too specific for core plugin

## Triggers Not Implementing

### Workflow Events
- **Workflow Complete/Failed** - Adds circular dependency complexity
- **Step Failed** - Complicates error handling flow

### System Events
- **File Upload** - Can use collection hooks on media collections
- **User Authentication** (Login/Logout) - Security implications
- **Server Start/Stop** - Lifecycle management complexity
- **Cache Clear** - Too implementation-specific
- **Migration/Backup Events** - Infrastructure-specific

### External Monitoring
- **Email Received** (IMAP/POP3) - Requires mail server setup
- **Git Webhooks** - Better as standard webhook triggers
- **Performance Alerts** - Requires monitoring infrastructure
- **Error Events** - Better handled by dedicated error tracking

### Advanced Time-Based
- **Recurring Patterns** (e.g., "every 2nd Tuesday") - Complex parsing and timezone handling
- **Date Range Triggers** - Can be achieved with conditional logic in workflows

## Why These Aren't Core Features

1. **Maintainability**: Each external integration requires ongoing maintenance as APIs change
2. **Security**: Many features have security implications that are better handled by users who understand their specific requirements
3. **Flexibility**: Users can implement these as custom steps/triggers tailored to their needs
4. **Scope**: The plugin focuses on being a solid workflow engine, not an everything-integration platform
5. **Dependencies**: Avoiding external service dependencies keeps the plugin lightweight

## What Users Can Do Instead

- Implement custom steps using the plugin's TaskConfig interface
- Use HTTP Request step for most external integrations  
- Create custom triggers through Payload hooks
- Build specialized workflow packages on top of this plugin