'use client'

import React, { useState } from 'react'
import { Button } from '@payloadcms/ui'

interface ErrorDisplayProps {
  value?: string
  onChange?: (value: string) => void
  readOnly?: boolean
  path?: string
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  value,
  onChange,
  readOnly = false
}) => {
  const [expanded, setExpanded] = useState(false)

  if (!value) {
    return null
  }

  // Parse common error patterns
  const parseError = (error: string) => {
    // Check for different error types and provide user-friendly messages
    if (error.includes('Request timeout')) {
      return {
        type: 'timeout',
        title: 'Request Timeout',
        message: 'The HTTP request took too long to complete. Consider increasing the timeout value or checking the target server.',
        technical: error
      }
    }

    if (error.includes('Network error') || error.includes('fetch')) {
      return {
        type: 'network',
        title: 'Network Error',
        message: 'Unable to connect to the target server. Please check the URL and network connectivity.',
        technical: error
      }
    }

    if (error.includes('Hook execution failed')) {
      return {
        type: 'hook',
        title: 'Workflow Hook Failed',
        message: 'The workflow trigger hook encountered an error. This may be due to PayloadCMS initialization issues.',
        technical: error
      }
    }

    if (error.includes('Executor not available')) {
      return {
        type: 'executor',
        title: 'Workflow Engine Unavailable',
        message: 'The workflow execution engine is not properly initialized. Try restarting the server.',
        technical: error
      }
    }

    if (error.includes('Collection slug is required') || error.includes('Document data is required')) {
      return {
        type: 'validation',
        title: 'Invalid Input Data',
        message: 'Required fields are missing from the workflow step configuration. Please check your step inputs.',
        technical: error
      }
    }

    if (error.includes('status') && error.includes('4')) {
      return {
        type: 'client',
        title: 'Client Error (4xx)',
        message: 'The request was rejected by the server. Check your API credentials and request format.',
        technical: error
      }
    }

    if (error.includes('status') && error.includes('5')) {
      return {
        type: 'server',
        title: 'Server Error (5xx)',
        message: 'The target server encountered an error. This is usually temporary - try again later.',
        technical: error
      }
    }

    // Generic error
    return {
      type: 'generic',
      title: 'Workflow Error',
      message: 'An error occurred during workflow execution. See technical details below.',
      technical: error
    }
  }

  const errorInfo = parseError(value)

  const getErrorIcon = (type: string) => {
    switch (type) {
      case 'timeout': return '⏰'
      case 'network': return '🌐'
      case 'hook': return '🔗'
      case 'executor': return '⚙️'
      case 'validation': return '📋'
      case 'client': return '🚫'
      case 'server': return '🔥'
      default: return '❗'
    }
  }

  const getErrorColor = (type: string) => {
    switch (type) {
      case 'timeout': return '#F59E0B'
      case 'network': return '#EF4444'
      case 'hook': return '#8B5CF6'
      case 'executor': return '#6B7280'
      case 'validation': return '#F59E0B'
      case 'client': return '#EF4444'
      case 'server': return '#DC2626'
      default: return '#EF4444'
    }
  }

  const errorColor = getErrorColor(errorInfo.type)

  return (
    <div style={{
      border: `2px solid ${errorColor}30`,
      borderRadius: '8px',
      backgroundColor: `${errorColor}08`,
      padding: '16px',
      marginTop: '8px'
    }}>
      {/* Error Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '12px'
      }}>
        <span style={{ fontSize: '24px' }}>
          {getErrorIcon(errorInfo.type)}
        </span>
        <div>
          <h4 style={{
            margin: 0,
            color: errorColor,
            fontSize: '16px',
            fontWeight: '600'
          }}>
            {errorInfo.title}
          </h4>
          <p style={{
            margin: '4px 0 0 0',
            color: '#6B7280',
            fontSize: '14px',
            lineHeight: '1.4'
          }}>
            {errorInfo.message}
          </p>
        </div>
      </div>

      {/* Technical Details Toggle */}
      <div>
        <div style={{ marginBottom: expanded ? '12px' : '0' }}>
          <Button
            buttonStyle="secondary"
            onClick={() => setExpanded(!expanded)}
            size="small"
          >
            {expanded ? 'Hide' : 'Show'} Technical Details
          </Button>
        </div>

        {expanded && (
          <div style={{
            backgroundColor: '#F8F9FA',
            border: '1px solid #E5E7EB',
            borderRadius: '6px',
            padding: '12px',
            fontFamily: 'monospace',
            fontSize: '13px',
            color: '#374151',
            whiteSpace: 'pre-wrap',
            overflowX: 'auto'
          }}>
            {errorInfo.technical}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div style={{
        marginTop: '12px',
        padding: '12px',
        backgroundColor: `${errorColor}10`,
        borderRadius: '6px',
        fontSize: '13px'
      }}>
        <strong>💡 Quick fixes:</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
          {errorInfo.type === 'timeout' && (
            <>
              <li>Increase the timeout value in step configuration</li>
              <li>Check if the target server is responding slowly</li>
            </>
          )}
          {errorInfo.type === 'network' && (
            <>
              <li>Verify the URL is correct and accessible</li>
              <li>Check firewall and network connectivity</li>
            </>
          )}
          {errorInfo.type === 'hook' && (
            <>
              <li>Restart the PayloadCMS server</li>
              <li>Check server logs for initialization errors</li>
            </>
          )}
          {errorInfo.type === 'executor' && (
            <>
              <li>Restart the PayloadCMS application</li>
              <li>Verify the automation plugin is properly configured</li>
            </>
          )}
          {errorInfo.type === 'validation' && (
            <>
              <li>Check all required fields are filled in the workflow step</li>
              <li>Verify JSONPath expressions in step inputs</li>
            </>
          )}
          {(errorInfo.type === 'client' || errorInfo.type === 'server') && (
            <>
              <li>Check API credentials and permissions</li>
              <li>Verify the request format matches API expectations</li>
              <li>Try the request manually to test the endpoint</li>
            </>
          )}
          {errorInfo.type === 'generic' && (
            <>
              <li>Check the workflow configuration</li>
              <li>Review server logs for more details</li>
              <li>Try running the workflow again</li>
            </>
          )}
        </ul>
      </div>

      {/* Hidden textarea for editing if needed */}
      {!readOnly && onChange && (
        <textarea
          onChange={(e) => onChange(e.target.value)}
          style={{ display: 'none' }}
          value={value}
        />
      )}
    </div>
  )
}
