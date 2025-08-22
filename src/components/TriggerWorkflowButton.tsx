'use client'

import { Button, toast } from '@payloadcms/ui'
import { useState } from 'react'

interface TriggerWorkflowButtonProps {
  workflowId: string
  workflowName: string
  triggerSlug?: string
}

export const TriggerWorkflowButton: React.FC<TriggerWorkflowButtonProps> = ({
  workflowId,
  workflowName,
  triggerSlug = 'manual-trigger'
}) => {
  const [loading, setLoading] = useState(false)

  const handleTrigger = async () => {
    setLoading(true)
    
    try {
      const response = await fetch('/api/workflows/trigger-custom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          triggerSlug,
          data: {
            triggeredAt: new Date().toISOString(),
            source: 'admin-button'
          }
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to trigger workflow')
      }

      const result = await response.json()
      
      toast.success(`Workflow "${workflowName}" triggered successfully! Run ID: ${result.runId}`)
    } catch (error) {
      console.error('Error triggering workflow:', error)
      toast.error(`Failed to trigger workflow: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleTrigger}
      disabled={loading}
      size="small"
      buttonStyle="secondary"
    >
      {loading ? 'Triggering...' : 'Trigger Workflow'}
    </Button>
  )
}