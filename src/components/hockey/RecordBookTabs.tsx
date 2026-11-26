import { Link } from "react-router";
export const recordBookTabs = [
  { label: "FPT Leaders", view: "fpt-leaders" },
  { label: "FPT Franchise Leaders", view: "fpt-franchise-leaders" },
  { label: "Franchise Records", view: "franchise-records" },
  { label: "League Records", view: "league-records" },
  { label: "Best/Worst", view: "best-worst" },
  { label: "Contracts", view: "contracts" },
  { label: "Career Earnings", view: "career-earnings" },
] as const;
export type RecordBookTab = typeof recordBookTabs[number]["label"];
export default function RecordBookTabs({active,onSelect}:{active:RecordBookTab;onSelect?:(label:Exclude<RecordBookTab,"Career Earnings">)=>void}) {
  const money=active==="Contracts"||active==="Career Earnings";
  const tabs=recordBookTabs.filter(tab=>money?(tab.label==="Contracts"||tab.label==="Career Earnings"):(tab.label!=="Contracts"&&tab.label!=="Career Earnings"));
  return <nav aria-label={money?"Contracts & Earnings sections":"Leaders & Record Books sections"} className="flex flex-wrap gap-2">{tabs.map(tab=>{
    const className=`rounded-lg px-3 py-2 text-xs font-bold ${active===tab.label?"bg-gray-900 text-white dark:bg-white dark:text-gray-900":"bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`;
    return tab.label!=="Career Earnings"&&onSelect
      ? <button key={tab.view} type="button" aria-current={active===tab.label?"page":undefined} onClick={()=>onSelect(tab.label as Exclude<RecordBookTab,"Career Earnings">)} className={className}>{tab.label}</button>
      : <Link key={tab.view} to={tab.label==="Career Earnings"?"/career-earnings":tab.label==="Contracts"?"/contracts":`/record-book?view=${tab.view}`} aria-current={active===tab.label?"page":undefined} className={className}>{tab.label}</Link>;
  })}</nav>;
}
