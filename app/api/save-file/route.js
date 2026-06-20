import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request) {
  try {
    const { filename, content } = await request.json();
    
    // Target the resources folder at the project root
    const resourcesDirectory = path.join(process.cwd(), 'resources');
    
    // Ensure the directory exists
    await fs.mkdir(resourcesDirectory, { recursive: true });

    // Write the CSV text payload directly to disk
    const targetFilePath = path.join(resourcesDirectory, filename);
    await fs.writeFile(targetFilePath, content, 'utf-8');

    return NextResponse.json({ success: true, message: `Saved ${filename}` });
  } catch (error) {
    console.error('[DISK WRITE FAULT]:', error);
    return NextResponse.json(
      { error: 'Failed to write data matrix to server disk.' },
      { status: 500 }
    );
  }
}