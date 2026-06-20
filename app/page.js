'use client';

import React, { useState, useRef, useMemo } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, RefreshCw, Layers, Database, BarChart3, Download, Search, MessageSquare, PieChart, Table } from 'lucide-react';
import Papa from 'papaparse';

export default function Home() {
  const [view, setView] = useState('upload'); // 'upload' | 'processing' | 'complete'
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'table'
  const [file, setFile] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState('');
  
  const [processingStage, setProcessingStage] = useState('');
  const [metrics, setMetrics] = useState({ original: 0, cleaned: 0, processed: 0 });
  const [finalDataset, setFinalDataset] = useState([]);

  const fileInputRef = useRef(null);

  // --- DRAG & DROP HANDLERS ---
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setIsDragActive(true);
    else if (e.type === 'dragleave') setIsDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) validateAndSetFile(e.target.files[0]);
  };

  const validateAndSetFile = (selectedFile) => {
    setError('');
    if (selectedFile.name.endsWith('.csv') || selectedFile.type === 'text/csv') setFile(selectedFile);
    else {
      setFile(null);
      setError('Invalid file format. Please upload a valid .csv dataset.');
    }
  };

  // --- DETERMINISTIC JS CLEANING ---
  const executeDataCleaning = (rawData) => {
    const seenIds = new Set();
    const seenTexts = new Set();
    const cleanedArray = [];

    rawData.forEach((row) => {
      const id = row.id ? String(row.id).trim() : '';
      const text = row.feedback_text ? String(row.feedback_text).trim() : '';

      if (!text) return; 
      if (seenIds.has(id) || seenTexts.has(text)) return; 
      
      if (id) seenIds.add(id);
      seenTexts.add(text);

      let standardizedTime = row.timestamp;
      if (row.timestamp) {
        const parsedDate = new Date(row.timestamp);
        if (!isNaN(parsedDate.getTime())) {
          standardizedTime = parsedDate.toISOString().replace('T', ' ').substring(0, 19);
        }
      }

      cleanedArray.push({ ...row, timestamp: standardizedTime || 'N/A' });
    });

    return cleanedArray;
  };

  // --- MASTER PIPELINE ORCHESTRATION ---
  const startPipeline = () => {
    if (!file) return;
    setView('processing');
    setProcessingStage('Ingesting file assets into system memory...');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rawData = results.data;
          
          setProcessingStage('Step 1: Running Deterministic JS Cleaning Filters...');
          await new Promise(resolve => setTimeout(resolve, 1000)); 
          
          const cleanData = executeDataCleaning(rawData);
          setMetrics(m => ({ ...m, original: rawData.length, cleaned: cleanData.length, processed: 0 }));

          setProcessingStage('Saving intermediate cleaned records to storage disk...');
          const baseName = file.name.replace('.csv', '');
          await fetch('/api/save-file', {
            method: 'POST',
            body: JSON.stringify({ filename: `${baseName}_cleaned.csv`, content: Papa.unparse(cleanData) })
          });

          const CHUNK_SIZE = 200;
          let finalEnrichedResults = [];

          for (let i = 0; i < cleanData.length; i += CHUNK_SIZE) {
            const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
            const totalBatches = Math.ceil(cleanData.length / CHUNK_SIZE);
            setProcessingStage(`Step 2: Transferring rows to LLM Engine (Batch ${batchNum} of ${totalBatches})...`);
            
            const chunk = cleanData.slice(i, i + CHUNK_SIZE);
            
            const llmPayload = chunk.map(row => ({
              id: row.id,
              rating: row.rating,
              feedback_text: row.feedback_text
            }));

            const enrichResponse = await fetch('/api/enrich', {
              method: 'POST',
              body: JSON.stringify({ rows: llmPayload })
            });

            const enrichData = await enrichResponse.json();
            if (!enrichResponse.ok) throw new Error(enrichData.error || 'LLM Engine Fault');

            const mergedChunk = chunk.map(originalRow => {
              const aiData = enrichData.data.find(ai => String(ai.id) === String(originalRow.id));
              if (aiData) {
                return { 
                  ...originalRow, 
                  sentiment: aiData.sentiment, 
                  category: aiData.category, 
                  issue_summary: aiData.issue_summary 
                };
              }
              return { ...originalRow, sentiment: "neutral", category: "Other", issue_summary: "Processing alignment shift." };
            });

            finalEnrichedResults = [...finalEnrichedResults, ...mergedChunk];
            setMetrics(m => ({ ...m, processed: finalEnrichedResults.length }));

            if (i + CHUNK_SIZE < cleanData.length) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          setProcessingStage('Saving ultimate enriched data array back to file system...');
          await fetch('/api/save-file', {
            method: 'POST',
            body: JSON.stringify({ filename: `${baseName}_enriched.csv`, content: Papa.unparse(finalEnrichedResults) })
          });

          setFinalDataset(finalEnrichedResults);
          setView('complete');
          setActiveTab('analytics'); // Default view upon complete

        } catch (err) {
          console.error(err);
          setError('Pipeline fractured during execution: ' + err.message);
          setView('upload');
        }
      },
      error: () => {
        setError('Failed to parse original CSV data structures.');
        setView('upload');
      }
    });
  };

  const downloadEnrichedCSV = () => {
    if (finalDataset.length === 0) return;
    const csvStr = Papa.unparse(finalDataset);
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${file.name.replace('.csv', '')}_enriched.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- COMPREHENSIVE JAVASCRIPT SUMMARY REPORT GENERATOR ENGINE ---
  const reportSummary = useMemo(() => {
    if (finalDataset.length === 0) return null;

    const total = finalDataset.length;
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    const categoryCounts = {};
    const categoryExamples = {};

    finalDataset.forEach(row => {
      // 1. Tabulate Sentiment Counts
      if (row.sentiment in sentimentCounts) {
        sentimentCounts[row.sentiment]++;
      } else {
        sentimentCounts.neutral++;
      }

      // 2. Tabulate Category Counts
      const cat = row.category || 'Other';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

      // 3. Harvest Representative Examples (Cap at 3)
      if (!categoryExamples[cat]) categoryExamples[cat] = [];
      if (categoryExamples[cat].length < 3 && row.feedback_text) {
        categoryExamples[cat].push(row.feedback_text);
      }
    });

    // 4. Transform and Rank Complaint Categories by Total Volume
    const rankedCategories = Object.entries(categoryCounts)
      .map(([name, count]) => ({ name, count, percentage: ((count / total) * 100).toFixed(1) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 5. Structure Precise Percentages For Formatting Output
    const sentimentBreakdown = {
      positive: { count: sentimentCounts.positive, pct: ((sentimentCounts.positive / total) * 100).toFixed(1) },
      negative: { count: sentimentCounts.negative, pct: ((sentimentCounts.negative / total) * 100).toFixed(1) },
      neutral: { count: sentimentCounts.neutral, pct: ((sentimentCounts.neutral / total) * 100).toFixed(1) },
    };

    return {
      total,
      rankedCategories,
      sentimentBreakdown,
      categoryExamples
    };
  }, [finalDataset]);

  return (
    <div className="h-screen w-screen bg-slate-900 text-slate-100 flex flex-col justify-between overflow-hidden antialiased relative">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <header className="relative z-10 max-w-7xl mx-auto w-full px-6 py-4 flex items-center border-b border-slate-800/40">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-600/10 rounded-lg border border-indigo-500/20 text-indigo-400">
            <Layers className="w-4 h-4" />
          </div>
          <span className="font-semibold tracking-wider text-xs text-slate-300">CFIS Platform</span>
        </div>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto w-full px-6 flex-1 flex flex-col justify-center items-center text-center my-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 rounded-full border border-indigo-500/30 text-indigo-300 text-xs font-semibold tracking-wide uppercase mb-4">
          BI3 Technologies
        </div>

        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white leading-tight mb-2">
          Customer Feedback <span className="bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">Intelligence System</span>
        </h1>
        
        <p className="text-sm text-slate-400 max-w-lg mb-6 leading-relaxed">
          Ingest unstructured metrics, normalize time matrices, and prepare automated LLM analytical pipelines.
        </p>

        {/* --- VIEW 1: UPLOAD WORKSPACE --- */}
        {view === 'upload' && (
          <div className="w-full max-w-xl bg-slate-800/40 border border-slate-700/60 backdrop-blur-md rounded-xl p-5 shadow-xl relative animate-in fade-in duration-300">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => !file && fileInputRef.current.click()}
              className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-all duration-150 ${file ? 'border-indigo-500/40 bg-indigo-500/5' : isDragActive ? 'border-indigo-400 bg-slate-800/80 scale-[1.005]' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/20 cursor-pointer'}`}
            >
              <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
              {!file ? (
                <>
                  <Upload className={`w-6 h-6 mb-3 ${isDragActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                  <h3 className="text-sm font-semibold text-slate-200 mb-0.5">Drop your dataset here</h3>
                  <p className="text-xs text-slate-400">Drag and drop or click to browse files (<span className="text-indigo-400 font-medium">.csv only</span>)</p>
                </>
              ) : (
                <>
                  <FileText className="w-6 h-6 text-indigo-400 mb-3" />
                  <h3 className="text-sm font-semibold text-slate-200 truncate mb-0.5">{file.name}</h3>
                  <p className="text-xs text-slate-400 mb-3">{(file.size / 1024).toFixed(2)} KB • Valid CSV</p>
                  <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-xs font-semibold text-rose-400 hover:text-rose-300 underline underline-offset-4 transition">Remove File</button>
                </>
              )}
            </div>
            {file && (
              <button onClick={startPipeline} className="w-full mt-3 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition shadow-md">
                <Database className="w-4 h-4" /> Run Data Optimization Pipeline
              </button>
            )}
            {error && <div className="mt-3 flex gap-2.5 text-left text-xs p-3 rounded-lg border bg-rose-500/10 border-rose-500/20 text-rose-300"><AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span></div>}
          </div>
        )}

        {/* --- VIEW 2: LOADING PROGRESS WINDOW --- */}
        {view === 'processing' && (
          <div className="w-full max-w-md bg-slate-800/40 border border-indigo-500/30 backdrop-blur-md rounded-xl p-8 shadow-2xl flex flex-col items-center justify-center animate-in zoom-in duration-300">
            <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mb-4" />
            <h3 className="text-lg font-bold text-slate-100 mb-2">Executing Data Pipeline</h3>
            <p className="text-xs font-medium text-indigo-300 bg-indigo-500/10 px-4 py-2 rounded-lg border border-indigo-500/20 animate-pulse text-center">
              {processingStage}
            </p>
            {metrics.cleaned > 0 && (
              <div className="w-full bg-slate-700 h-1.5 rounded-full mt-6 overflow-hidden">
                <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${(metrics.processed / metrics.cleaned) * 100}%` }}></div>
              </div>
            )}
            <p className="text-[10px] text-slate-500 mt-2 tracking-wider uppercase">
              {metrics.processed} / {metrics.cleaned} entries combined
            </p>
          </div>
        )}

        {/* --- VIEW 3: PIPELINE EXECUTION SUMMARY VIEW (TAB CONTROLLED) --- */}
        {view === 'complete' && reportSummary && (
          <div className="w-full bg-slate-800/60 border border-slate-700/60 backdrop-blur-md rounded-xl p-5 shadow-2xl flex flex-col animate-in zoom-in duration-300 h-[60vh]">
            
            {/* Top Toolbar controls */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-700/50 pb-3 mb-3 gap-3">
              <div className="flex items-center gap-2.5 text-left">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Analysis Matrix Compiled</h3>
                  <p className="text-[11px] text-slate-400">Disk cluster storage sync complete inside /resources</p>
                </div>
              </div>
              
              {/* Tab Navigation System Frame */}
              <div className="flex items-center bg-slate-900/80 p-1 rounded-lg border border-slate-700/50 text-xs font-medium self-start sm:self-auto">
                <button 
                  onClick={() => setActiveTab('analytics')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition ${activeTab === 'analytics' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <PieChart className="w-3.5 h-3.5" /> Summary Report
                </button>
                <button 
                  onClick={() => setActiveTab('table')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition ${activeTab === 'table' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <Table className="w-3.5 h-3.5" /> Data Table Preview
                </button>
              </div>

              <div className="flex gap-2 self-end sm:self-auto">
                <button onClick={() => { setView('upload'); setFile(null); }} className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition">
                  Restart
                </button>
                <button onClick={downloadEnrichedCSV} className="inline-flex gap-1.5 items-center px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition shadow-md">
                  <Download className="w-3.5 h-3.5" /> Export Data
                </button>
              </div>
            </div>

            {/* --- COMPONENT BOX SWITCHER SLOTS --- */}
            <div className="flex-1 overflow-auto rounded-lg">
              
              {/* TAB SUB-COMPONENT A: EXECUTIVE ANALYTICS INSIGHTS WINDOW */}
              {activeTab === 'analytics' && (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 h-full text-left animate-in fade-in duration-150">
                  
                  {/* Left Parameter Panel: Sentiment Matrix Counts & Percent distributions */}
                  <div className="md:col-span-2 flex flex-col gap-3">
                    <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-3.5 flex flex-col justify-between flex-1">
                      <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                          <PieChart className="w-3.5 h-3.5 text-indigo-400" /> Overall Sentiment Breakdown
                        </h4>
                        
                        {/* Prompt Required Presentation Target String Formatting Output Layout */}
                        <div className="text-xs font-semibold bg-slate-900 border border-slate-800 rounded-md p-2 mb-4 text-indigo-300 font-mono flex justify-center items-center">
                          positive: {reportSummary.sentimentBreakdown.positive.pct}% , negative: {reportSummary.sentimentBreakdown.negative.pct}% , neutral: {reportSummary.sentimentBreakdown.neutral.pct}%
                        </div>

                        <div className="space-y-2.5">
                          {['positive', 'neutral', 'negative'].map(type => {
                            const data = reportSummary.sentimentBreakdown[type];
                            const barColors = { positive: 'bg-emerald-500', neutral: 'bg-amber-500', negative: 'bg-rose-500' };
                            const textColors = { positive: 'text-emerald-400', neutral: 'text-amber-400', negative: 'text-rose-400' };
                            return (
                              <div key={type} className="space-y-1 text-[11px]">
                                <div className="flex justify-between items-center font-medium capitalize">
                                  <span className={textColors[type]}>{type}</span>
                                  <span className="text-slate-400">{data.count} rows ({data.pct}%)</span>
                                </div>
                                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                  <div className={`h-full ${barColors[type]}`} style={{ width: `${data.pct}%` }}></div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 italic mt-3 border-t border-slate-800/60 pt-2">
                        Metrics computed on qualitative context arrays. Text variables override original numerical ratings.
                      </div>
                    </div>
                  </div>

                  {/* Right Parameter Panel: Top 5 Categories & Qualitative Sample Text Extracts */}
                  <div className="md:col-span-3 flex flex-col gap-3 h-full overflow-hidden">
                    <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-3.5 flex flex-col h-full overflow-hidden">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 shrink-0">
                        <BarChart3 className="w-3.5 h-3.5 text-indigo-400" /> Top Complaint Categories & Examples
                      </h4>
                      
                      <div className="flex-1 overflow-auto space-y-3.5 pr-1">
                        {reportSummary.rankedCategories.map((category, idx) => (
                          <div key={category.name} className="border-b border-slate-800/60 last:border-0 pb-3 last:pb-0 space-y-1.5">
                            <div className="flex justify-between text-xs font-bold">
                              <span className="text-indigo-300">{idx + 1}. {category.name} Module</span>
                              <span className="text-slate-400 font-medium">{category.count} incidents ({category.percentage}%)</span>
                            </div>
                            
                            {/* Representative messages nested loop */}
                            <div className="space-y-1 pl-2 border-l border-indigo-500/20">
                              {reportSummary.categoryExamples[category.name]?.map((example, eIdx) => (
                                <p key={eIdx} className="text-[11px] text-slate-400 leading-normal italic truncate max-w-xl" title={example}>
                                  &ldquo;{example}&rdquo;
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* TAB SUB-COMPONENT B: INTERACTIVE DATA PREVIEW TABLE GRID */}
              {activeTab === 'table' && (
                <div className="h-full border border-slate-700/40 bg-slate-900/50 overflow-auto animate-in fade-in duration-150 rounded-lg shadow-inner">
                  <table className="w-full text-left text-xs text-slate-300 border-collapse">
                    <thead className="bg-slate-800/80 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold w-16">Row ID</th>
                        <th className="px-4 py-2.5 font-semibold w-24">Sentiment</th>
                        <th className="px-4 py-2.5 font-semibold w-32">Category</th>
                        <th className="px-4 py-2.5 font-semibold">AI Generated Issue Summary</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {finalDataset.slice(0, 50).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30 transition">
                          <td className="px-4 py-2 font-mono text-[10px] text-slate-500">{row.id || `#${idx+1}`}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${row.sentiment === 'negative' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : row.sentiment === 'positive' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>{row.sentiment}</span>
                          </td>
                          <td className="px-4 py-2 font-medium text-indigo-300">{row.category}</td>
                          <td className="px-4 py-2 text-slate-400 truncate max-w-[320px]" title={row.issue_summary}>{row.issue_summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>

            {/* Bottom preview metadata string banner footer */}
            <div className="text-left mt-2.5 text-[10px] text-slate-500 flex items-center gap-1.5 border-t border-slate-800/60 pt-2 shrink-0">
              <Search className="w-3 h-3" /> Toggle view modules above. Download the complete structured dataset package using the Export function button.
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 max-w-7xl mx-auto w-full px-6 py-4 border-t border-slate-800/40 flex justify-center text-[10px] text-slate-500 tracking-wider">
        <div className="flex gap-4 font-medium uppercase">
          <span className="text-slate-400">Next.js App Router Node</span>
          <span>•</span>
          <span className="text-slate-400">Tailwind Engine V3</span>
        </div>
      </footer>
    </div>
  );
}