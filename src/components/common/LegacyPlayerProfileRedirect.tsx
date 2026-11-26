import {Navigate,useLocation,useParams} from "react-router";

export default function LegacyPlayerProfileRedirect(){
  const {playerId}=useParams();
  const {search}=useLocation();
  const params=new URLSearchParams(search);
  params.set("playerId",playerId||"");
  return <Navigate replace to={`/player-profile?${params.toString()}`}/>;
}
