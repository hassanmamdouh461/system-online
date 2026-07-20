Set WshShell = CreateObject("WScript.Shell")
strPath = Wscript.ScriptFullName
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objFile = objFSO.GetFile(strPath)
strFolder = objFSO.GetParentFolderName(objFile)

' Project root is one folder up
strProjectRoot = objFSO.GetParentFolderName(strFolder)
WshShell.CurrentDirectory = strProjectRoot

' Prepend the portable Node.js folder to the PATH environment variable
nodePath = strProjectRoot & "\..\node-v20.11.1-win-x64"
cmdLine = "cmd.exe /c ""set PATH=" & nodePath & ";%PATH% && npm run electron:dev"""

' Run with window style 0 (hidden) and wait = False
WshShell.Run cmdLine, 0, False
