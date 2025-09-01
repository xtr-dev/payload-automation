# 🚨 Critical Update: PayloadCMS Automation Plugin v0.0.16

## ⚡ Immediate Action Required

A **critical bug** has been identified and fixed in v0.0.15 that prevented workflows from executing in development environments. **Please update immediately** to resolve workflow execution issues.

## 🔧 Quick Update Steps

### 1. Update the Package
```bash
npm update @xtr-dev/payload-automation
# OR
yarn upgrade @xtr-dev/payload-automation
# OR  
pnpm update @xtr-dev/payload-automation
```

### 2. Verify Version
Check that you're now on v0.0.16:
```bash
npm list @xtr-dev/payload-automation
```

### 3. Restart Your Development Server
```bash
# Stop your current dev server (Ctrl+C)
# Then restart
npm run dev
# OR
yarn dev  
# OR
pnpm dev
```

### 4. Test Your Workflows
Your workflows should now execute properly! Look for these log messages:

```
[payload-automation] Plugin initialized successfully - all hooks registered
AUTOMATION PLUGIN: Collection hook triggered
executeTriggeredWorkflows called
Found workflows to check
```

## 🐛 What Was Fixed

### Critical Bug: Hook Registration Failure
- **Problem**: The `hooksInitialized` flag prevented proper hook registration in development mode
- **Symptom**: Workflows would not execute even when correctly configured  
- **Fix**: Removed the problematic flag, ensuring hooks register on every initialization

### Enhanced Debugging
- **Added**: Comprehensive logging with "AUTOMATION PLUGIN:" prefix
- **Added**: Try/catch blocks to prevent silent failures
- **Added**: Better error messages and stack traces

## 🔍 Troubleshooting

### If workflows still don't execute after updating:

1. **Check your workflow configuration** (should now use v0.0.15+ schema):
   ```javascript
   // ✅ Correct v0.0.15+ schema
   {
     triggers: [{
       type: 'collection-trigger',
       collectionSlug: 'orders',
       operation: 'update', 
       condition: '$.trigger.doc.status == "Paid"' // JSONPath format
     }],
     steps: [{
       step: 'uppercaseText',  // 'step' not 'type'
       name: 'Process Order',
       input: {               // 'input' not 'inputs'
         inputText: '$.trigger.doc.orderName has been paid!'
       }
     }]
   }
   ```

2. **Verify plugin configuration** includes your collections:
   ```javascript
   automationPlugin({
     collections: ['orders', 'users', 'products'], // Must include target collections
     // ... other config
   })
   ```

3. **Check the logs** for "AUTOMATION PLUGIN:" messages during hook execution

4. **Ensure workflow status**: If using versioning, make sure workflows are "Published" not "Draft"

## 📋 Schema Changes Recap (from v0.0.14 → v0.0.15+)

If you haven't updated your workflows since v0.0.14, you'll also need to update the schema:

### Triggers
```javascript
// ❌ OLD v0.0.14
conditions: [
  { field: 'status', operator: 'equals', value: 'Paid' }
]

// ✅ NEW v0.0.15+
condition: '$.trigger.doc.status == "Paid"'
```

### Steps  
```javascript
// ❌ OLD v0.0.14
{
  type: 'uppercaseText',
  inputs: { inputText: 'Hello' }
}

// ✅ NEW v0.0.15+
{
  step: 'uppercaseText', 
  input: { inputText: 'Hello' }
}
```

## 🆘 Support

If you're still experiencing issues after updating to v0.0.16:

1. **Check console logs** for "AUTOMATION PLUGIN:" messages
2. **Verify your workflow schema** matches v0.0.15+ format  
3. **Confirm plugin configuration** includes target collections
4. **File an issue** at https://github.com/anthropics/claude-code/issues with:
   - PayloadCMS version
   - Complete console logs during workflow execution
   - Your workflow configuration (sanitized)

## ✅ Success Indicators

After updating, you should see:
- ✅ Workflow runs created in `workflow-runs` collection
- ✅ "AUTOMATION PLUGIN:" log messages during hook execution  
- ✅ Jobs appearing in `payload-jobs` collection
- ✅ Workflow steps executing successfully

---

**This is a critical bug fix release - no breaking changes, just fixes the core functionality that wasn't working in v0.0.15.**