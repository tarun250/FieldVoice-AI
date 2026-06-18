// page.js
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Search, 
  Activity, 
  Clock, 
  User, 
  AlertTriangle, 
  AlertCircle, 
  CheckCircle, 
  Play, 
  Volume2, 
  ShieldAlert, 
  Sparkles, 
  ClipboardCheck,
  FileCheck2,
  Lock
} from 'lucide-react';

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert';
import { cn } from '../lib/utils';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';

// Helper to compute relative time since incident reported
const timeSince = (dateString) => {
  if (!dateString) return 'N/A';
  const now = new Date();
  const past = new Date(dateString);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

export default function SupervisorDashboard() {
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  const [isSseConnected, setIsSseConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  
  // Interactive form states
  const [statusInput, setStatusInput] = useState('OPEN');
  const [actionsInput, setActionsInput] = useState('');
  const [partsInput, setPartsInput] = useState('');
  const [loadingAction, setLoadingAction] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Resizable panels widths
  const [leftPanelWidth, setLeftPanelWidth] = useState(340);
  const [rightPanelWidth, setRightPanelWidth] = useState(340);

  // Fetch initial list of work orders
  const fetchWorkOrders = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/work-orders`);
      if (response.ok) {
        const data = await response.json();
        setWorkOrders(data);
      } else {
        console.error('Failed to fetch initial work orders list');
      }
    } catch (err) {
      console.error('Network error fetching work orders:', err.message);
    }
  }, []);

  // Fetch full details of a specific work order (including joined voice transcript details)
  const fetchWorkOrderDetail = useCallback(async (id) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/work-orders/${id}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedWorkOrder(data);
        setStatusInput(data.status || 'OPEN');
        setActionsInput(data.actions_taken || '');
        setPartsInput(data.parts_required ? data.parts_required.join(', ') : '');
        setErrorMessage('');
      } else {
        console.error(`Failed to fetch work order details for ID ${id}`);
      }
    } catch (err) {
      console.error('Error fetching work order details:', err.message);
    }
  }, []);

  // Establish SSE real-time connection on mount
  useEffect(() => {
    fetchWorkOrders();

    const streamUrl = `${BACKEND_URL}/api/work-orders/stream`;
    console.log(`Connecting to SSE stream at ${streamUrl}`);
    const eventSource = new EventSource(streamUrl);

    eventSource.onopen = () => {
      console.log('SSE connection successfully opened.');
      setIsSseConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received SSE message:', message);
        
        if (message.type === 'work-order-created') {
          setWorkOrders((prev) => [message.payload, ...prev]);
        } else if (message.type === 'work-order-updated' || message.type === 'work-order-closed') {
          setWorkOrders((prev) =>
            prev.map((wo) => (wo.id === message.payload.id ? { ...wo, ...message.payload } : wo))
          );
          
          setSelectedWorkOrder((prev) => {
            if (prev && prev.id === message.payload.id) {
              return { ...prev, ...message.payload };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('Error parsing real-time SSE stream payload:', err.message);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      setIsSseConnected(false);
      eventSource.close();
    };

    return () => {
      console.log('Closing SSE EventSource stream connection.');
      eventSource.close();
    };
  }, [fetchWorkOrders]);

  // Mouse drag handler for left sidebar resizer
  const handleLeftMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidth;

    const doDrag = (moveEvent) => {
      const newWidth = Math.max(240, Math.min(startWidth + (moveEvent.clientX - startX), 500));
      setLeftPanelWidth(newWidth);
    };

    const stopDrag = () => {
      window.removeEventListener('mousemove', doDrag);
      window.removeEventListener('mouseup', stopDrag);
    };

    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);
  }, [leftPanelWidth]);

  // Mouse drag handler for right sidebar controls resizer
  const handleRightMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const doDrag = (moveEvent) => {
      const newWidth = Math.max(260, Math.min(startWidth - (moveEvent.clientX - startX), 480));
      setRightPanelWidth(newWidth);
    };

    const stopDrag = () => {
      window.removeEventListener('mousemove', doDrag);
      window.removeEventListener('mouseup', stopDrag);
    };

    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);
  }, [rightPanelWidth]);

  // Handle updates to Status, Actions Taken, and Parts Required
  const handleUpdateWorkOrder = async (e) => {
    e.preventDefault();
    if (!selectedWorkOrder) return;
    
    setLoadingAction(true);
    setErrorMessage('');
    
    // Parse parts string list back to array
    const partsArray = partsInput
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    try {
      const response = await fetch(`${BACKEND_URL}/api/work-orders/${selectedWorkOrder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: statusInput,
          actions_taken: actionsInput,
          parts_required: partsArray
        })
      });

      if (response.ok) {
        const updated = await response.json();
        // Force list refresh and local detail update
        await fetchWorkOrders();
        setSelectedWorkOrder(updated);
      } else {
        const errData = await response.json();
        setErrorMessage(errData.error || 'Failed to update work order properties.');
      }
    } catch (err) {
      setErrorMessage(`Network connection error: ${err.message}`);
    } finally {
      setLoadingAction(false);
    }
  };

  // Close the active work order permanently (sets status to CLOSED)
  const handleCloseWorkOrder = async () => {
    if (!selectedWorkOrder) return;

    setLoadingAction(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/work-orders/${selectedWorkOrder.id}/close`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions_taken: actionsInput || 'Work order resolved and closed by supervisor.'
        })
      });

      if (response.ok) {
        const updated = await response.json();
        await fetchWorkOrders();
        setSelectedWorkOrder(updated);
        setStatusInput('CLOSED');
      } else {
        const errData = await response.json();
        setErrorMessage(errData.error || 'Failed to finalize work order closure.');
      }
    } catch (err) {
      setErrorMessage(`Network connection error: ${err.message}`);
    } finally {
      setLoadingAction(false);
    }
  };

  // Compute filtered work orders list
  const filteredWorkOrders = useMemo(() => {
    return workOrders.filter((wo) => {
      const searchStr = `${wo.equipment_tag} ${wo.fault_code} ${wo.logged_by_username || ''}`.toLowerCase();
      const searchMatch = searchStr.includes(searchQuery.toLowerCase());
      const statusMatch = statusFilter === 'ALL' || wo.status === statusFilter;
      const severityMatch = severityFilter === 'ALL' || wo.severity === severityFilter;

      return searchMatch && statusMatch && severityMatch;
    });
  }, [workOrders, searchQuery, statusFilter, severityFilter]);

  // Compute active alerts (Critical severity or low STT confidence exception flag)
  const activeAlerts = useMemo(() => {
    return workOrders.filter(
      (wo) => 
        (wo.severity === 'CRITICAL' || wo.exception_flag === true || (wo.confidence_score !== null && wo.confidence_score < 0.70)) &&
        wo.status !== 'CLOSED'
    );
  }, [workOrders]);

  // Severity style helper mapping to shadcn badge variants
  const getSeverityBadgeVariant = (severity) => {
    switch(severity) {
      case 'CRITICAL': return 'destructive';
      case 'HIGH': return 'warning';
      case 'MEDIUM': return 'default';
      default: return 'outline';
    }
  };

  // Status style helper mapping to shadcn badge variants
  const getStatusBadgeVariant = (status) => {
    switch(status) {
      case 'RESOLVED': return 'success';
      case 'IN_PROGRESS': return 'info';
      case 'CLOSED': return 'secondary';
      default: return 'default';
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans select-none antialiased">
      {/* Real-time Operator Header Bar */}
      <header className="h-11 px-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white shadow-sm">
        <div className="flex items-center gap-3">
          {/* Logo Icon & Console Breadcrumbs */}
          <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center text-white shrink-0">
            <Activity className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-xs font-bold tracking-tight text-slate-900">
            FieldVoice
          </span>
          <span className="text-slate-300 text-xs select-none">/</span>
          <span className="text-xs font-medium text-slate-500">
            Operations Control Room
          </span>
        </div>
        
        {/* Right Controls Status & Profile */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-50 border border-slate-200 text-[10px] font-medium text-slate-600 select-none">
            <span className={cn("w-1.5 h-1.5 rounded-full", isSseConnected ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
            <span>{isSseConnected ? 'Live' : 'Offline'}</span>
          </div>
          <div className="w-px h-3.5 bg-slate-200" />
          <div className="flex items-center gap-2 select-none">
            <div className="w-5 h-5 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-[9px] font-bold text-slate-700">
              SV
            </div>
            <span className="text-[11px] font-medium text-slate-600 hidden sm:inline">Supervisor</span>
          </div>
        </div>
      </header>

      {/* Grid Dashboard Panel */}
      <main className="flex flex-1 overflow-hidden min-h-0">
        
        {/* Left Panel: Operations Queue sidebar */}
        <section 
          className="border-r border-slate-200 flex flex-col bg-slate-50 shrink-0 h-full"
          style={{ width: `${leftPanelWidth}px` }}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Operations Queue
            </span>
            <span className="text-[10px] font-bold text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200">
              {filteredWorkOrders.length} active
            </span>
          </div>

          {/* Filters Area */}
          <div className="p-2 border-b border-slate-200 bg-white/60 shrink-0 space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <Input
                type="text"
                placeholder="Search queue tag, fault..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                id="search-input"
                className="pl-7 bg-white border-slate-300 text-xs h-7 text-slate-800 placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-blue-600/30"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                id="status-filter"
                className="bg-white border-slate-300 text-xs h-7 py-0 text-slate-705 focus-visible:border-blue-600"
              >
                <option value="ALL">All Status</option>
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="RESOLVED">Resolved</option>
                <option value="CLOSED">Closed</option>
              </Select>
              <Select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                id="severity-filter"
                className="bg-white border-slate-300 text-xs h-7 py-0 text-slate-705 focus-visible:border-blue-600"
              >
                <option value="ALL">All Severity</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </Select>
            </div>
          </div>

          {/* Alarm Notifications Strip */}
          {activeAlerts.length > 0 && (
            <div className="px-2 py-1.5 border-b border-slate-200 bg-red-50/20 shrink-0 space-y-1">
              <div className="flex items-center gap-1 text-[9px] font-bold text-red-655 uppercase tracking-wider">
                <AlertTriangle className="w-2.5 h-2.5 text-red-600" />
                <span>{activeAlerts.length} Attention Required</span>
              </div>
              <div className="space-y-1">
                {activeAlerts.slice(0, 2).map((alert) => (
                  <div
                    key={`alert-${alert.id}`}
                    onClick={() => fetchWorkOrderDetail(alert.id)}
                    className="cursor-pointer text-[10px] px-2 py-1 rounded bg-white border border-red-200/85 hover:bg-red-50/50 transition-all flex items-center justify-between"
                  >
                    <span className="font-semibold text-red-750 truncate max-w-[190px]">
                      {alert.equipment_tag || 'Asset'}: {alert.fault_code}
                    </span>
                    <span className="text-[8px] text-red-600 font-bold lowercase tracking-wider">{alert.severity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Structured Queue Row Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 bg-white">
            {filteredWorkOrders.length === 0 ? (
              <div className="text-center text-slate-400 py-12 text-xs italic">
                No matching incidents in queue.
              </div>
            ) : (
              filteredWorkOrders.map((wo) => {
                const isSelected = selectedWorkOrder?.id === wo.id;
                
                // Severity left indicator mapping
                const getSeverityLeftBorder = (severity) => {
                  switch(severity) {
                    case 'CRITICAL': return 'border-l-red-600';
                    case 'HIGH': return 'border-l-amber-500';
                    case 'MEDIUM': return 'border-l-amber-400/80';
                    default: return 'border-l-slate-300';
                  }
                };

                return (
                  <div
                    key={wo.id}
                    className={cn(
                      "cursor-pointer transition-all duration-75 px-3 py-2.5 border-l-[3px] border-b border-slate-100 flex flex-col gap-1 select-none",
                      getSeverityLeftBorder(wo.severity),
                      isSelected 
                        ? "bg-slate-100/85" 
                        : "bg-transparent hover:bg-slate-50/60"
                    )}
                    onClick={() => fetchWorkOrderDetail(wo.id)}
                  >
                    {/* First line: Asset ID & Time Since Reported */}
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-800 tracking-tight">{wo.equipment_tag || 'No Tag'}</span>
                      <span className="text-[10px] text-slate-450 font-medium whitespace-nowrap">
                        {timeSince(wo.offline_created_at || wo.created_at)}
                      </span>
                    </div>

                    {/* Second line: Fault Code */}
                    <div className="text-xs text-slate-600 truncate">
                      {wo.fault_code}
                    </div>

                    {/* Third line: Assignee, Status badge, Severity Badge */}
                    <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                      <span className="truncate max-w-[150px]">
                        Assignee: <span className="font-semibold text-slate-700">{wo.logged_by_username || 'unassigned'}</span>
                      </span>
                      <div className="flex gap-1 items-center">
                        <Badge variant={getSeverityBadgeVariant(wo.severity)} className="text-[8px] py-0 px-1 border-none lowercase">
                          {wo.severity}
                        </Badge>
                        <Badge variant={getStatusBadgeVariant(wo.status)} className="text-[8px] py-0 px-1 border-none lowercase">
                          {wo.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Left Resizer Splitter Line */}
        <div 
          className="w-[3px] hover:w-1 cursor-col-resize hover:bg-blue-500 bg-slate-200/50 transition-all select-none self-stretch shrink-0 z-10"
          onMouseDown={handleLeftMouseDown}
        />

        {/* Right Panel: Incident Workspace */}
        <section className="flex-1 flex flex-col bg-white h-full overflow-hidden">
          {/* Header */}
          <div className="px-6 h-10 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/40">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-3.5 h-3.5 text-slate-550" />
              <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Incident Telemetry Workspace
              </h2>
            </div>
            {selectedWorkOrder && (
              <div className="flex gap-2">
                <Badge variant={getSeverityBadgeVariant(selectedWorkOrder.severity)} className="text-[9px] font-semibold border border-slate-200">
                  {selectedWorkOrder.severity}
                </Badge>
                <Badge variant={getStatusBadgeVariant(selectedWorkOrder.status)} className="text-[9px] font-semibold border border-slate-200">
                  {selectedWorkOrder.status}
                </Badge>
              </div>
            )}
          </div>

          {/* Details Workspace (Double columns layout with individual scrolling) */}
          <div className="flex-1 flex overflow-hidden bg-white">
            {!selectedWorkOrder ? (
              <div className="flex flex-col items-center justify-center h-full w-full text-center p-8 space-y-2">
                <FileCheck2 className="w-8 h-8 text-slate-303" />
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">No Incident Selected</h3>
                <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                  Choose a ticket from the left panel queue to inspect technician transcripts, original audio playback, and metadata.
                </p>
              </div>
            ) : (
              <div className="flex flex-grow flex-row gap-0 items-start h-full w-full">
                
                {/* Left Area: Incident Specifications & Evidential Logs */}
                <div 
                  className="flex-1 min-w-0 space-y-6 p-6 overflow-y-auto h-full"
                  style={{ maxWidth: `calc(100% - ${rightPanelWidth}px)` }}
                >
                  
                  {/* Title Segment (GitHub breadcrumb hierarchy layout) */}
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 select-none">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">INCIDENTS</span>
                        <span className="text-slate-300 text-[10px]">/</span>
                        <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase">{selectedWorkOrder.equipment_tag}</span>
                        <span className="text-slate-300 text-[10px]">/</span>
                        <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase">{selectedWorkOrder.fault_code}</span>
                      </div>
                      <h2 className="text-lg font-bold text-slate-900 tracking-tight mt-1.5">
                        {selectedWorkOrder.equipment_name || 'Asset Specifications'}
                      </h2>
                    </div>
                  </div>

                  <hr className="border-slate-200" />

                  {/* Core Telemetry parameters (Inline Grid Layout) */}
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Core Parameters</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="space-y-0.5">
                        <span className="text-[9px] uppercase font-bold text-slate-450 tracking-wider block">Asset ID</span>
                        <span className="text-xs font-bold text-slate-800 block mt-0.5">{selectedWorkOrder.equipment_tag}</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[9px] uppercase font-bold text-slate-455 tracking-wider block">Assignee</span>
                        <span className="text-xs font-semibold text-slate-705 block mt-0.5">{selectedWorkOrder.logged_by_username || 'unassigned'}</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[9px] uppercase font-bold text-slate-455 tracking-wider block">Location</span>
                        <span className="text-xs font-semibold text-slate-705 block mt-0.5">{selectedWorkOrder.location || 'N/A'}</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[9px] uppercase font-bold text-slate-455 tracking-wider block">Reported Time</span>
                        <span className="text-xs font-semibold text-slate-705 block mt-0.5 truncate">
                          {timeSince(selectedWorkOrder.offline_created_at || selectedWorkOrder.created_at)} ({new Date(selectedWorkOrder.offline_created_at || selectedWorkOrder.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Transcript Evidence Layout (Content separated from metadata) */}
                  <div className="space-y-3 pt-2">
                    <div className="border border-slate-200 rounded overflow-hidden shadow-sm">
                      <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex justify-between items-center select-none">
                        <span className="text-xs font-bold text-slate-450 uppercase tracking-wider">Operational Transcript Evidence</span>
                        <span className="text-[9px] font-bold text-slate-455 uppercase tracking-wider">whisper confidence: {Math.round(selectedWorkOrder.confidence_score * 100)}%</span>
                      </div>
                      <div className="p-4 bg-white">
                        {selectedWorkOrder.raw_transcript ? (
                          <div className={cn(
                            "p-3.5 bg-slate-50/70 border-l-2 border-blue-600 rounded text-xs leading-relaxed text-slate-800 font-mono italic",
                            selectedWorkOrder.exception_flag && "border-red-500 bg-red-50/20 text-red-900"
                          )}>
                            "{selectedWorkOrder.raw_transcript}"
                          </div>
                        ) : (
                          <div className="text-xs text-slate-450 italic text-center py-6">
                            No voice recording transcript logs are linked to this ticket.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Resizer Splitter Line */}
                <div 
                  className="w-[3px] hover:w-1 cursor-col-resize hover:bg-blue-500 bg-slate-200/50 transition-all select-none self-stretch shrink-0 z-10"
                  onMouseDown={handleRightMouseDown}
                />

                {/* Right Area: Controls Form */}
                <form 
                  className="shrink-0 space-y-6 p-6 overflow-y-auto h-full bg-slate-50/15" 
                  style={{ width: `${rightPanelWidth}px` }}
                  onSubmit={handleUpdateWorkOrder}
                >
                  
                  {/* STAGE 1: AUDIT & REVIEW */}
                  <div className="space-y-3.5">
                    <div className="flex flex-col gap-0.5 border-b border-slate-200 pb-1.5">
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Workflow Step 1</span>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Audit & Review</h4>
                    </div>

                    {/* Audio Controls */}
                    {selectedWorkOrder.audio_storage_url && (
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-500 uppercase font-bold flex items-center gap-1.5 select-none">
                          <Volume2 className="w-3.5 h-3.5 text-blue-500" />
                          Voice Note Playback
                        </label>
                        <audio
                          controls
                          className="w-full h-8 rounded border border-slate-200 bg-slate-50 p-1 text-xs"
                          src={`${BACKEND_URL}${selectedWorkOrder.audio_storage_url}`}
                        />
                      </div>
                    )}

                    {/* Exception Box warning banner */}
                    {selectedWorkOrder.exception_flag && (
                      <Alert variant="destructive" className="p-2.5">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <div className="space-y-0.5 pl-5">
                          <AlertTitle className="text-[9px] font-bold uppercase tracking-wider leading-none">Review Required</AlertTitle>
                          <AlertDescription className="text-[9px] text-red-700/80 leading-normal mt-1">
                            Whisper engine confidence score did not meet safety limits.
                          </AlertDescription>
                        </div>
                      </Alert>
                    )}
                  </div>

                  {/* STAGE 2: INCIDENT UPDATE */}
                  <div className="space-y-3.5">
                    <div className="flex flex-col gap-0.5 border-b border-slate-200 pb-1.5">
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Workflow Step 2</span>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Incident Update</h4>
                    </div>

                    {/* Status select */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Set Incident Status</label>
                      <Select
                        value={statusInput}
                        onChange={(e) => setStatusInput(e.target.value)}
                        disabled={selectedWorkOrder.status === 'CLOSED'}
                        className="bg-white border-slate-300"
                      >
                        <option value="OPEN">Open</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="RESOLVED">Resolved</option>
                        <option value="CLOSED">Closed</option>
                      </Select>
                    </div>

                    {/* Actions taken */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Logged Resolution Details</label>
                      <Textarea
                        placeholder="Log maintenance actions..."
                        value={actionsInput}
                        onChange={(e) => setActionsInput(e.target.value)}
                        disabled={selectedWorkOrder.status === 'CLOSED'}
                        className="bg-white border-slate-300 min-h-[70px] text-xs font-sans text-slate-800"
                      />
                    </div>

                    {/* Parts list */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Parts List</label>
                      <Input
                        type="text"
                        placeholder="e.g. Gasket, Valve Seal"
                        value={partsInput}
                        onChange={(e) => setPartsInput(e.target.value)}
                        disabled={selectedWorkOrder.status === 'CLOSED'}
                        className="bg-white border-slate-300 text-xs text-slate-800"
                      />
                    </div>
                  </div>

                  {/* STAGE 3: RESOLUTION & CLOSURE */}
                  <div className="space-y-3.5">
                    <div className="flex flex-col gap-0.5 border-b border-slate-200 pb-1.5">
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">Workflow Step 3</span>
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Resolution & Closure</h4>
                    </div>

                    {/* Form errors */}
                    {errorMessage && (
                      <Alert variant="destructive" className="py-2 px-3">
                        <AlertDescription className="text-[9px] text-red-700">{errorMessage}</AlertDescription>
                      </Alert>
                    )}

                    {/* Buttons */}
                    {selectedWorkOrder.status !== 'CLOSED' ? (
                      <div className="space-y-2 pt-0.5">
                        <Button
                          type="submit"
                          className="w-full font-semibold border-none"
                          disabled={loadingAction}
                        >
                          {loadingAction ? 'Updating...' : 'Apply Details'}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleCloseWorkOrder}
                          disabled={loadingAction}
                          className="w-full font-semibold border border-red-200 text-red-650 bg-white hover:bg-red-50 flex items-center justify-center gap-1.5"
                        >
                          <Lock className="w-3 h-3 text-red-600" />
                          {loadingAction ? 'Locking...' : 'Lock and Close Incident'}
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center p-3 border border-dashed border-slate-200 bg-slate-50 rounded text-[9px] text-slate-450 flex items-center justify-center gap-1.5 font-bold uppercase tracking-wider select-none">
                        <Lock className="w-3 h-3 text-slate-400" />
                        Incident Locked & Closed
                      </div>
                    )}
                  </div>
                </form>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
