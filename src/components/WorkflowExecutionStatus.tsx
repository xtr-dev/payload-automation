'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@payloadcms/ui'

interface WorkflowRun {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  error?: string
  triggeredBy: string
}

interface WorkflowExecutionStatusProps {
  workflowId: string | number
}

export const WorkflowExecutionStatus: React.FC<WorkflowExecutionStatusProps> = ({ workflowId }) => {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const fetchRecentRuns = async () => {
      try {
        const response = await fetch(`/api/workflow-runs?where[workflow][equals]=${workflowId}&limit=5&sort=-startedAt`)
        if (response.ok) {
          const data = await response.json()
          setRuns(data.docs || [])
        }
      } catch (error) {
        console.warn('Failed to fetch workflow runs:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchRecentRuns()
  }, [workflowId])

  if (loading) {
    return (
      <div style={{ padding: '16px', color: '#6B7280' }}>
        Loading execution history...
      </div>
    )
  }

  if (runs.length === 0) {
    return null
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return '⏳'
      case 'running': return '🔄'
      case 'completed': return '✅'
      case 'failed': return '❌'
      case 'cancelled': return '⏹️'
      default: return '❓'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#6B7280'
      case 'running': return '#3B82F6'
      case 'completed': return '#10B981'
      case 'failed': return '#EF4444'
      case 'cancelled': return '#F59E0B'
      default: return '#6B7280'
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    
    if (diffMs < 60000) { // Less than 1 minute
      return 'Just now'
    } else if (diffMs < 3600000) { // Less than 1 hour
      return `${Math.floor(diffMs / 60000)} min ago`
    } else if (diffMs < 86400000) { // Less than 1 day
      return `${Math.floor(diffMs / 3600000)} hrs ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  const getDuration = (startedAt: string, completedAt?: string) => {
    const start = new Date(startedAt)
    const end = completedAt ? new Date(completedAt) : new Date()
    const diffMs = end.getTime() - start.getTime()
    
    if (diffMs < 1000) return '<1s'
    if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s`
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ${Math.floor((diffMs % 60000) / 1000)}s`
    return `${Math.floor(diffMs / 3600000)}h ${Math.floor((diffMs % 3600000) / 60000)}m`
  }

  const recentRun = runs[0]
  const recentStatus = getStatusIcon(recentRun.status)
  const recentColor = getStatusColor(recentRun.status)

  return (
    <div style={{
      border: '1px solid #E5E7EB',
      borderRadius: '8px',
      backgroundColor: '#FAFAFA'
    }}>
      {/* Summary Header */}
      <div style={{
        padding: '16px',
        borderBottom: expanded ? '1px solid #E5E7EB' : 'none',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px' }}>{recentStatus}</span>
          <div>
            <div style={{ fontWeight: '600', color: recentColor }}>
              Last run: {recentRun.status}
            </div>
            <div style={{ fontSize: '13px', color: '#6B7280' }}>
              {formatDate(recentRun.startedAt)} • Duration: {getDuration(recentRun.startedAt, recentRun.completedAt)}
            </div>
          </div>
        </div>
        
        <Button
          onClick={() => setExpanded(!expanded)}
          size="small"
          buttonStyle="secondary"
        >
          {expanded ? 'Hide' : 'Show'} History ({runs.length})
        </Button>
      </div>

      {/* Detailed History */}
      {expanded && (
        <div style={{ padding: '16px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600' }}>
            Recent Executions
          </h4>
          
          {runs.map((run, index) => (
            <div
              key={run.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                marginBottom: index < runs.length - 1 ? '8px' : '0',
                backgroundColor: 'white',
                border: '1px solid #E5E7EB',
                borderRadius: '6px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>
                  {getStatusIcon(run.status)}
                </span>
                
                <div>
                  <div style={{ 
                    fontSize: '13px', 
                    fontWeight: '500',
                    color: getStatusColor(run.status)
                  }}>
                    {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {formatDate(run.startedAt)} • {run.triggeredBy}
                  </div>
                </div>
              </div>
              
              <div style={{ 
                fontSize: '12px', 
                color: '#6B7280',
                textAlign: 'right'
              }}>
                <div>
                  {getDuration(run.startedAt, run.completedAt)}
                </div>
                {run.error && (
                  <div style={{ color: '#EF4444', marginTop: '2px' }}>
                    Error
                  </div>
                )}
              </div>
            </div>
          ))}
          
          <div style={{ 
            marginTop: '12px', 
            textAlign: 'center' 
          }}>
            <Button
              onClick={() => {
                // Navigate to workflow runs filtered by this workflow
                window.location.href = `/admin/collections/workflow-runs?where[workflow][equals]=${workflowId}`
              }}
              size="small"
              buttonStyle="secondary"
            >
              View All Runs →
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}