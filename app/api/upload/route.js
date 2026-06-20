import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    // 1. Guard against empty payloads
    if (!file) {
      return NextResponse.json(
        { error: 'No raw data resource file detected in multi-part buffer configuration request.' },
        { status: 400 }
      );
    }

    // 2. Enforce strict CSV type-checking security parameters
    if (!file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'Invalid file format footprint detected. System parameters accept only .csv structures.' },
        { status: 400 }
      );
    }

    // Convert file object data structures into local node system array stream storage buffers
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 3. Map destination to the local project root's 'resources' directory
    const resourcesDirectory = path.join(process.cwd(), 'resources');
    
    // Ensure the destination target directory structure is present on disk mount array
    await fs.mkdir(resourcesDirectory, { recursive: true });

    // Establish complete structural path naming criteria for filesystem writing
    const targetFilePath = path.join(resourcesDirectory, file.name);
    
    // Write the raw content matrix data to local storage configuration destination
    await fs.writeFile(targetFilePath, buffer);

    return NextResponse.json({
      success: true,
      message: `Data resource loaded and successfully stored at location: "resources/${file.name}"`,
    });

  } catch (error) {
    console.error('[CRITICAL SEVERITY PIPELINE FAULT]:', error);
    return NextResponse.json(
      { error: 'Internal system fault writing data asset structure stream matrix to server disk array.' },
      { status: 500 }
    );
  }
}