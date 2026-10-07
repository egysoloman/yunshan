import hashlib, json, pathlib, os
os.environ['MPLCONFIGDIR']='/tmp/ROOT24-matplotlib-config'
os.environ['XDG_CACHE_HOME']='/tmp/ROOT24-font-cache'
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
base=pathlib.Path(__file__).resolve().parent
source=base/'NATIVE04-ENDPOINT-STATISTICS.json'; data=json.loads(source.read_text())
a=data['snapshots']['originalMain3900']; b=data['snapshots']['terminal5340']
items=[('Resident wallets (thousand yuan)',[a['residentCash']['preciseSum']/1000,b['residentCash']['preciseSum']/1000],(0,240),'#47675a',lambda x:f'{x:.2f}'),('Residents with satiety < 30',[a['hunger']['below30'],b['hunger']['below30']],(0,140),'#9c4841',lambda x:f'{x:.0f}'),('Company capital (yuan)',[a['companyCapital']['preciseSum'],b['companyCapital']['preciseSum']],(0,1200),'#8f7542',lambda x:f'{x:.2f}'),('Saved district employment rate (%)',[a['employment']['savedDistrictEmploymentWeightedByEndpointAdultCount']*100,b['employment']['savedDistrictEmploymentWeightedByEndpointAdultCount']*100],(0,100),'#576e7c',lambda x:f'{x:.2f}')]
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False})
fig,axes=plt.subplots(2,2,figsize=(12,7),facecolor='#f4f2e9');fig.suptitle('Yunshan | one-day continuation',fontsize=22,x=.06,ha='left',y=.96)
for ax,(name,values,limits,color,format_value) in zip(axes.flat,items):
 ax.set_facecolor('#f4f2e9');ax.bar([0,1],values,width=.46,color=['#b7c4bc',color]);ax.set_title(name,loc='left',fontsize=13,pad=16);ax.set_ylim(*limits);ax.set_xticks([0,1],['Day 2 / 17:00','Day 3 / 17:00']);ax.grid(axis='y',color='#d7d8d0',alpha=.7);ax.set_axisbelow(True)
 for i,v in enumerate(values):ax.text(i,v+limits[1]*.025,format_value(v),ha='center',fontweight='bold',color='#25352f')
fig.text(.06,.035,'616 residents | Original save endpoints | 344 + 16 audited windows / 2 cold segments\nSaved employment rate is a district aggregate; long-run stability is not established.',fontsize=10,color='#4b5752')
fig.subplots_adjust(left=.075,right=.96,top=.84,bottom=.17,wspace=.22,hspace=.5)
for extension in ['png','svg']:fig.savefig(base/('ROOT24-ECONOMY-ENDPOINTS.'+extension),dpi=180,facecolor=fig.get_facecolor())
plt.close(fig)
metadata={'status':'ACTUAL_ORIGINAL_ENDPOINT_PLOT','simulationConstructions':0,'ordinarySteps':0,'source':str(source),'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'chartValues':[{'metric':i[0],'values':i[1]} for i in items],'limitations':'Endpoint differences, not a 14-day steady state or complete cause attribution. Company count grows 12 to 13. Saved employment rate is not reconstructed individual job eligibility.'}
(base/'ROOT24-ECONOMY-ENDPOINTS.provenance.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps({'status':'PLOT_CREATED','files':['ROOT24-ECONOMY-ENDPOINTS.png','ROOT24-ECONOMY-ENDPOINTS.svg']}))
