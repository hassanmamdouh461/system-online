Set WshShell = CreateObject("WScript.Shell")
strPath = Wscript.ScriptFullName
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objFile = objFSO.GetFile(strPath)
strFolder = objFSO.GetParentFolderName(objFile)

WshShell.CurrentDirectory = strFolder

' Prepend the portable Node.js folder to the PATH environment variable
nodePath = strFolder & "\..\node-v20.11.1-win-x64"
cmdLine = "cmd.exe /c ""set PATH=" & nodePath & ";%PATH% && npm run electron:dev"""

' Run with window style 0 (hidden) and wait = False
WshShell.Run cmdLine, 0, False
