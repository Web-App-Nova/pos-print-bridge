param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,
  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, DOCINFO di);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

  public static void SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "OpenPrinter failed");
    }
    try {
      var di = new DOCINFO { pDocName = "POS Print", pDataType = "RAW" };
      if (!StartDocPrinter(hPrinter, 1, di)) {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "StartDocPrinter failed");
      }
      try {
        if (!StartPagePrinter(hPrinter)) {
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "StartPagePrinter failed");
        }
        try {
          int written;
          if (!WritePrinter(hPrinter, bytes, bytes.Length, out written)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "WritePrinter failed");
          }
        } finally {
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
[RawPrinterHelper]::SendBytes($PrinterName, $bytes)
