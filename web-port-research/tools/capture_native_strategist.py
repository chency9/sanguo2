"""Launch only the hash-pinned game under a bounded Windows debugger.

Read the strategist table at the original MAGIC.INI loader return, then terminate
only the process created here. One software breakpoint in private process memory;
no file patch, input automation, existing-process attachment or game save write.
"""
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
from pathlib import Path
import struct
import time
import argparse

ROOT=Path(__file__).resolve().parents[1]
SHA='1098558aaea96ae552753df786a8d3910df08fda11c8219dfa133ca001d8e419'
PTR=C.c_void_p
SIZE=C.c_size_t

class STARTUPINFO(C.Structure):
    _fields_=[('cb',W.DWORD),('reserved',W.LPWSTR),('desktop',W.LPWSTR),('title',W.LPWSTR),
              ('x',W.DWORD),('y',W.DWORD),('width',W.DWORD),('height',W.DWORD),
              ('cols',W.DWORD),('rows',W.DWORD),('fill',W.DWORD),('flags',W.DWORD),
              ('show',W.WORD),('reservedSize',W.WORD),('reservedBytes',PTR),
              ('stdin',W.HANDLE),('stdout',W.HANDLE),('stderr',W.HANDLE)]
class PROCESSINFO(C.Structure):
    _fields_=[('process',W.HANDLE),('thread',W.HANDLE),('pid',W.DWORD),('tid',W.DWORD)]
class EXCEPTION(C.Structure):
    _fields_=[('code',W.DWORD),('flags',W.DWORD),('record',PTR),('address',PTR),('count',W.DWORD),('info',SIZE*15)]
class EXCEPTIONINFO(C.Structure):
    _fields_=[('record',EXCEPTION),('firstChance',W.DWORD)]
class CREATED(C.Structure):
    _fields_=[('file',W.HANDLE),('process',W.HANDLE),('thread',W.HANDLE),('base',PTR),
              ('debugOffset',W.DWORD),('debugSize',W.DWORD),('tls',PTR),('start',PTR),('name',PTR),('unicode',W.WORD)]
class DLL(C.Structure):
    _fields_=[('file',W.HANDLE),('base',PTR),('debugOffset',W.DWORD),('debugSize',W.DWORD),('name',PTR),('unicode',W.WORD)]
class EVENTDATA(C.Union):
    _fields_=[('exception',EXCEPTIONINFO),('created',CREATED),('dll',DLL),('exitCode',W.DWORD),('raw',C.c_ubyte*160)]
class EVENT(C.Structure):
    _fields_=[('code',W.DWORD),('pid',W.DWORD),('tid',W.DWORD),('data',EVENTDATA)]


def capture(exe, timeout):
    assert C.sizeof(PTR)==8 and C.sizeof(EVENT)==176,'Use 64-bit Windows Python'
    assert hashlib.sha256(exe.read_bytes()).hexdigest()==SHA,'Unexpected EXE'
    k=C.WinDLL('kernel32',use_last_error=True)
    def api(name,args,result=W.BOOL):
        fn=getattr(k,name);fn.argtypes=args;fn.restype=result;return fn
    create=api('CreateProcessW',[W.LPCWSTR,W.LPWSTR,PTR,PTR,W.BOOL,W.DWORD,PTR,W.LPCWSTR,C.POINTER(STARTUPINFO),C.POINTER(PROCESSINFO)])
    wait=api('WaitForDebugEvent',[C.POINTER(EVENT),W.DWORD])
    resume=api('ContinueDebugEvent',[W.DWORD,W.DWORD,W.DWORD])
    read=api('ReadProcessMemory',[W.HANDLE,PTR,PTR,SIZE,C.POINTER(SIZE)])
    write=api('WriteProcessMemory',[W.HANDLE,PTR,PTR,SIZE,C.POINTER(SIZE)])
    flush=api('FlushInstructionCache',[W.HANDLE,PTR,SIZE])
    terminate=api('TerminateProcess',[W.HANDLE,W.UINT])
    close=api('CloseHandle',[W.HANDLE])
    pi=PROCESSINFO();si=STARTUPINFO();si.cb=C.sizeof(si);si.flags=1;si.show=0
    # DEBUG_ONLY_THIS_PROCESS; Start hidden. The original executable is unchanged.
    if not create(str(exe),None,None,None,False,2,None,str(exe.parent),C.byref(si),C.byref(pi)):
        raise C.WinError(C.get_last_error())
    report={'exeSha256':SHA,'pid':pi.pid,'method':'Windows debug event / original loader return',
            'breakpoint':'0x42F91D','events':[],'status':'timeout'}
    def memory(addr,size):
        buf=C.create_string_buffer(size);n=SIZE()
        if not read(pi.process,addr,buf,size,C.byref(n)) or n.value!=size:raise C.WinError(C.get_last_error())
        return buf.raw
    try:
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            ev=EVENT()
            if not wait(C.byref(ev),1000):
                if C.get_last_error()==121:continue
                raise C.WinError(C.get_last_error())
            status=0x10002
            if ev.code==3:
                if ev.data.created.file:close(ev.data.created.file)
                assert ev.data.created.base==0x400000,'Relocated image unsupported'
                original=memory(0x42f91d,1)
                n=SIZE()
                if not write(pi.process,0x42f91d,C.c_char_p(b'\xcc'),1,C.byref(n)):raise C.WinError(C.get_last_error())
                flush(pi.process,0x42f91d,1)
                report['breakpointOriginal']=original.hex()
            elif ev.code==6 and ev.data.dll.file:close(ev.data.dll.file)
            elif ev.code==1:
                ex=ev.data.exception.record
                report['events'].append({'code':hex(ex.code),'address':hex(ex.address or 0),'firstChance':ev.data.exception.firstChance})
                if ex.code in [0x80000003,0x4000001f] and ex.address==0x42f91d:
                    table=struct.unpack('<I',memory(0x4a61a8,4))[0]
                    rows=[]
                    for seq in range(68):
                        name,attrib,active,rate,execute,level=struct.unpack('<6i',memory(table+24*seq,24))
                        rows.append(dict(sequence=seq,attribute=attrib,active=active,rate=rate,execute=execute,level=level))
                    report.update(status='captured',tableAddress=hex(table),rows=rows,
                                  rng=list(struct.unpack('<2I',memory(0x4922fc,8))),
                                  loaderKey=memory(0x48cc58,5).hex())
                    break
                if ex.code not in [0x80000003,0x4000001f]:status=0x80010001
                if not ev.data.exception.firstChance:
                    report['status']='unhandled-exception';break
            elif ev.code==5:
                report.update(status='exited-before-loader',exitCode=ev.data.exitCode);break
            resume(ev.pid,ev.tid,status)
    finally:
        terminate(pi.process,0)
        close(pi.thread);close(pi.process)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--timeout',type=int,default=30)
    parser.add_argument('--output',default='runtime-strategist.json')
    args=parser.parse_args()
    exe=next((ROOT.parent/'game-original-105plus').rglob('Sango2.exe'))
    report=capture(exe,args.timeout)
    path=ROOT/'evidence/ai'/args.output
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'path':str(path),'status':report['status'],'rates':sorted({r['rate'] for r in report.get('rows',[])[1:]})}))
