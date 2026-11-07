export function actionDialogs({$}){
 let queue=Promise.resolve();
 function ask(message,input=false){
  const work=queue.then(()=>new Promise(resolve=>{
   const dialog=$('#actionDialog'),form=$('#actionForm'),field=$('#actionInput');let settled=false,answer=input?null:false;
   const finish=value=>{if(settled)return;answer=value;dialog.close();};
   $('#actionTitle').textContent=input?'核对商品 ID':'操作确认';$('#actionMessage').textContent=message;
   $('#actionInputLabel').classList.toggle('hidden',!input);field.disabled=!input;field.required=input;field.value='';field.setCustomValidity('');
   form.onsubmit=event=>{event.preventDefault();if(input&&!/^[1-9][0-9]{0,14}$/.test(field.value.trim())){field.setCustomValidity('请填写有效的数字商品ID');field.reportValidity();return;}finish(input?field.value.trim():true);};
   field.oninput=()=>field.setCustomValidity('');$('#actionCancel').onclick=()=>finish(input?null:false);$('#actionClose').onclick=()=>finish(input?null:false);
   dialog.oncancel=event=>{event.preventDefault();finish(input?null:false);};dialog.onclose=()=>{if(settled)return;settled=true;resolve(answer);};
   dialog.showModal();(input?field:$('#actionCancel')).focus();
  }));queue=work.catch(()=>{});return work;
 }
 return {confirm:message=>ask(message),prompt:message=>ask(message,true)};
}
