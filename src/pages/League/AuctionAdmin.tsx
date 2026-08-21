import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import { fetchFantasyTeams, type FantasyTeam } from "../../lib/fantasyTeams";
import {
  fetchProfiles,
  updateProfileDisplayName,
  upsertProfile,
  type Profile,
} from "../../lib/profiles";
import {
  deleteTeamUserAssignment,
  fetchTeamUserAssignments,
  upsertTeamUserAssignment,
  type TeamUserAssignmentWithTeam,
} from "../../lib/teamUserAssignments";
import { closeAuction, deleteAuction, fetchAuctions, nominateAuction, setAuctionPaused, undoAuctionAward, type Auction } from "../../lib/auctions";
import { createPlayerSeason, fetchFantasyPlayers, fetchPlayerSeasonsBySeason, type FantasyPlayer, type PlayerSeasonWithRelations } from "../../lib/fantasyPlayers";
import { fetchNhlPlayerLanding } from "../../lib/nhl";

const seasonOptions = Array.from({ length: 10 }, (_, index) => 2026 + index);

function getProfileLabel(profile: Profile) {
  return profile.display_name || profile.email || profile.id;
}

function getAssignmentUserLabel(assignment: TeamUserAssignmentWithTeam) {
  return (
    assignment.profile?.display_name ||
    assignment.profile?.email ||
    assignment.user_email ||
    assignment.user_id
  );
}

export default function AuctionAdmin() {
  const { user } = useAuth();
  const [selectedSeason, setSelectedSeason] = useState(2027);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<FantasyTeam[]>([]);
  const [assignments, setAssignments] = useState<TeamUserAssignmentWithTeam[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedDisplayProfileId, setSelectedDisplayProfileId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [editingAssignmentId, setEditingAssignmentId] = useState<number | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [deletingAssignmentId, setDeletingAssignmentId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [playerSeasons, setPlayerSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [previousPlayerSeasons, setPreviousPlayerSeasons] = useState<PlayerSeasonWithRelations[]>([]);
  const [players, setPlayers] = useState<FantasyPlayer[]>([]);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [nomineeId, setNomineeId] = useState("");
  const [auctionType, setAuctionType] = useState<"ufa"|"rfa">("ufa");
  const [rosterPosition, setRosterPosition] = useState("C");
  const [rfaQualified, setRfaQualified] = useState(true);
  const [savingAuction, setSavingAuction] = useState(false);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [profileRows, teamRows, assignmentRows, seasonRows, previousSeasonRows, playerRows, auctionRows] = await Promise.all([
        fetchProfiles(),
        fetchFantasyTeams(),
        fetchTeamUserAssignments(selectedSeason),
        fetchPlayerSeasonsBySeason(selectedSeason),
        fetchPlayerSeasonsBySeason(selectedSeason - 1),
        fetchFantasyPlayers(),
        fetchAuctions(selectedSeason),
      ]);
      setProfiles(profileRows);
      setTeams(teamRows);
      setAssignments(assignmentRows);
      setPlayerSeasons(seasonRows);
      setPreviousPlayerSeasons(previousSeasonRows);
      setPlayers(playerRows);
      setAuctions(auctionRows);
      setEditingAssignmentId(null);
      setSelectedProfileId("");
      setSelectedTeamId("");

      if (user && !profileRows.some((profile) => profile.id === user.id)) {
        const currentProfile = await upsertProfile({
          userId: user.id,
          email: user.email || null,
          displayName: null,
        });
        setProfiles([currentProfile, ...profileRows]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load auction admin data.");
    } finally {
      setLoading(false);
    }
  }

  const selectedPlayerId = Number(nomineeId);
  const selectedPlayer = players.find((row) => row.id === selectedPlayerId);
  const selectedNominee = playerSeasons.find((row) => row.player_id === selectedPlayerId);
  const previousNominee = previousPlayerSeasons.find((row) => row.player_id === selectedPlayerId);
  const requiredQualifyingAav = Math.max(Math.round((previousNominee?.salary||0)*0.5),500000);
  async function selectNominee(value:string){setNomineeId(value);const player=players.find(item=>item.id===Number(value));const row=playerSeasons.find(item=>item.player_id===Number(value));const storedPosition=(row?.position||"").toUpperCase();setAuctionType(storedPosition==="RFA"?"rfa":"ufa");setRfaQualified(true);if(["C","LW","RW","D","G"].includes(storedPosition)){setRosterPosition(storedPosition);return;}if(player?.player_api_id){try{const landing=await fetchNhlPlayerLanding(Number(player.player_api_id));const position=landing.position==="L"?"LW":landing.position==="R"?"RW":landing.position;if(position&&["C","LW","RW","D","G"].includes(position))setRosterPosition(position);}catch{/* Position remains editable if NHL data is unavailable. */}}}
  async function handleNominate(){if(!user||!selectedPlayer)return;setSavingAuction(true);setError("");setSuccess("");try{const effectiveType=auctionType==="rfa"&&rfaQualified?"rfa":"ufa";const wasUnqualifiedRfa=auctionType==="rfa"&&!rfaQualified;const hasPreviousContract=previousPlayerSeasons.some(row=>row.player_id===selectedPlayer.id&&row.salary!=null);const minimumAav=effectiveType==="rfa"||wasUnqualifiedRfa||hasPreviousContract?500000:750000;let seasonRow=selectedNominee;if(!seasonRow){if(effectiveType==="rfa")throw new Error("Create an RFA rights record and assign its rights team before nominating this player as an RFA.");seasonRow=await createPlayerSeason({player_id:selectedPlayer.id,season_year:selectedSeason,fantasy_team_id:null,salary:null,position:rosterPosition,term_end_year:null,contract_group:"UFA",notes:"Created automatically by Auction Admin nomination."});}if(effectiveType==="rfa"&&!seasonRow.fantasy_team_id)throw new Error("Assign the player's RFA rights to a team before opening blind bidding.");await nominateAuction({playerSeasonId:seasonRow.id,seasonYear:selectedSeason,type:effectiveType,position:rosterPosition,rightsTeamId:effectiveType==="rfa"?seasonRow.fantasy_team_id:null,qualifyingAav:effectiveType==="rfa"?requiredQualifyingAav:null,minimumAav,nominatedBy:user.id});setSuccess(effectiveType==="rfa"?`Qualified RFA nominated with a one-year $${requiredQualifyingAav.toLocaleString()} rights-owner offer. Sealed bidding is open for 90 seconds.`:`Player nominated for open UFA bidding at a $${minimumAav.toLocaleString()} minimum.`);setNomineeId("");await loadData();}catch(err){setError(err instanceof Error?err.message:"Unable to nominate player.");}finally{setSavingAuction(false);}}
  async function handleCloseAuction(id:number){setError("");try{await closeAuction(id);setSuccess("Bidding closed. Sealed offers are now revealed and the winning offer was processed.");await loadData();}catch(err){setError(err instanceof Error?err.message:"Unable to close auction.");}}
  async function handlePauseAuction(auction:Auction){setError("");setSuccess("");try{await setAuctionPaused(auction.id,!auction.paused_at);setSuccess(auction.paused_at?"Auction timer resumed.":"Auction timer paused. Bidding is disabled.");await loadData();}catch(err){setError(err instanceof Error?err.message:"Unable to update the auction timer.");}}
  async function handleRemoveAuction(auction:Auction){const player=auction.player_season?.player?.full_name||auction.player_name;const warning=auction.status==="completed"?" This will not reverse an awarded contract or transaction.":"";const bids=auction.auction_type==="rfa"&&auction.status==="open"?"all sealed bid records":`all ${auction.auction_bids.length} bid records`;if(!window.confirm(`Remove the ${player} auction and ${bids}?${warning}`))return;setError("");setSuccess("");try{await deleteAuction(auction.id);setAuctions(current=>current.filter(row=>row.id!==auction.id));setSuccess(`${player} was removed from the Auction Log.`);}catch(err){setError(err instanceof Error?err.message:"Unable to remove the auction.");}}
  async function handleUndoAuction(auction:Auction){const player=auction.player_season?.player?.full_name||auction.player_name;if(!window.confirm(`Undo the ${player} auction result? This restores the pre-auction roster records and deletes the auction-generated transaction.`))return;setError("");setSuccess("");try{await undoAuctionAward(auction.id);setSuccess(`${player}'s auction result was undone and the previous roster state was restored.`);await loadData();}catch(err){setError(err instanceof Error?err.message:"Unable to undo the auction result.");}}

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason]);

  useEffect(() => {
    if (selectedDisplayProfileId) return;

    const currentProfile =
      profiles.find((profile) => profile.id === user?.id) || profiles[0];

    if (currentProfile) {
      setSelectedDisplayProfileId(currentProfile.id);
      setDisplayName(currentProfile.display_name || "");
    }
  }, [profiles, selectedDisplayProfileId, user]);

  async function handleSaveDisplayName() {
    const selectedProfile = profiles.find(
      (profile) => profile.id === selectedDisplayProfileId,
    );
    if (!selectedProfile) return;

    setSavingProfile(true);
    setError("");
    setSuccess("");

    try {
      const nextProfile = await updateProfileDisplayName({
        userId: selectedProfile.id,
        displayName: displayName.trim() || null,
      });
      setProfiles((current) =>
        current.map((profile) =>
          profile.id === nextProfile.id ? nextProfile : profile,
        ),
      );
      setAssignments((current) =>
        current.map((assignment) =>
          assignment.user_id === nextProfile.id
            ? { ...assignment, profile: nextProfile }
            : assignment,
        ),
      );
      setSuccess("Display name saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save display name.");
    } finally {
      setSavingProfile(false);
    }
  }

  function handleSelectDisplayProfile(profileId: string) {
    const selectedProfile = profiles.find((profile) => profile.id === profileId);
    setSelectedDisplayProfileId(profileId);
    setDisplayName(selectedProfile?.display_name || "");
    setError("");
    setSuccess("");
  }

  async function handleSaveAssignment() {
    const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
    if (!selectedProfile || !selectedTeamId) return;

    setSavingAssignment(true);
    setError("");
    setSuccess("");

    try {
      const nextAssignment = await upsertTeamUserAssignment({
        userId: selectedProfile.id,
        userEmail: selectedProfile.email,
        fantasyTeamId: Number(selectedTeamId),
        seasonYear: selectedSeason,
      });
      setAssignments((current) => [
        { ...nextAssignment, profile: selectedProfile },
        ...current.filter((assignment) => assignment.id !== nextAssignment.id),
      ]);
      setSuccess("Team assignment saved.");
      setEditingAssignmentId(null);
      setSelectedProfileId("");
      setSelectedTeamId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save team assignment.");
    } finally {
      setSavingAssignment(false);
    }
  }

  function handleEditAssignment(assignment: TeamUserAssignmentWithTeam) {
    setEditingAssignmentId(assignment.id);
    setSelectedProfileId(assignment.user_id);
    setSelectedTeamId(String(assignment.fantasy_team_id));
    setError("");
    setSuccess("");
  }

  function handleClearAssignmentForm() {
    setEditingAssignmentId(null);
    setSelectedProfileId("");
    setSelectedTeamId("");
    setError("");
    setSuccess("");
  }

  async function handleDeleteAssignment(assignment: TeamUserAssignmentWithTeam) {
    const userLabel = getAssignmentUserLabel(assignment);
    const teamLabel = assignment.fantasy_team?.team_name || "this team";
    const confirmed = window.confirm(
      `Remove ${userLabel}'s access to ${teamLabel} for ${assignment.season_year}?`,
    );

    if (!confirmed) return;

    setDeletingAssignmentId(assignment.id);
    setError("");
    setSuccess("");

    try {
      await deleteTeamUserAssignment(assignment.id);
      setAssignments((current) =>
        current.filter((row) => row.id !== assignment.id),
      );

      if (editingAssignmentId === assignment.id) {
        handleClearAssignmentForm();
      }

      setSuccess("Team assignment removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove team assignment.");
    } finally {
      setDeletingAssignmentId(null);
    }
  }

  return (
    <>
      <PageMeta
        title="Great Lakes Dynasty Hockey League"
        description="Manage GLDHL auction users and team assignments"
      />
      <PageBreadcrumb pageTitle="Auction Admin" />

      <div className="space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Auction Admin
              </p>
              <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                Users and Team Assignments
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Assign league users to fantasy teams by auction season.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                Season
              </label>
              <select
                value={selectedSeason}
                onChange={(event) => setSelectedSeason(Number(event.target.value))}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 sm:w-36"
              >
                {seasonOptions.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading && (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Loading auction admin data...
            </p>
          )}
          {error && (
            <div className="mt-4 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {error}
            </div>
          )}
          {success && (
            <div className="mt-4 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300">
              {success}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4"><p className="text-xs font-semibold uppercase text-gray-500">Auction Control</p><h2 className="text-lg font-semibold text-gray-900 dark:text-white">Nominate a player</h2><p className="mt-1 text-sm text-gray-500">Qualified RFAs receive 90 seconds of sealed bidding. Unqualified players enter the open UFA auction.</p></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="xl:col-span-2"><label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Player</label><select value={nomineeId} onChange={e=>selectNominee(e.target.value)} className="h-11 w-full rounded-lg border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-900"><option value="">Choose player</option>{players.filter(player=>!auctions.some(a=>a.player_season?.player_id===player.id&&!a.resolution)).sort((a,b)=>(a.full_name||"").localeCompare(b.full_name||"")).map(player=>{const row=playerSeasons.find(item=>item.player_id===player.id);return <option key={player.id} value={player.id}>{player.full_name||[player.first_name,player.last_name].filter(Boolean).join(" ")} — {row?.fantasy_team?.abbreviation||"FA"} ({row?.position||"No season record"})</option>;})}</select></div>
            <div><label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Type</label><select value={auctionType} onChange={e=>setAuctionType(e.target.value as "ufa"|"rfa")} className="h-11 w-full rounded-lg border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-900"><option value="ufa">UFA — Open</option><option value="rfa">RFA — Blind</option></select></div>
            <div><label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Roster Position</label><select value={rosterPosition} onChange={e=>setRosterPosition(e.target.value)} className="h-11 w-full rounded-lg border border-gray-300 px-3 dark:border-gray-700 dark:bg-gray-900">{["C","LW","RW","D","G"].map(p=><option key={p}>{p}</option>)}</select></div>
            <div><label className="mb-1 block text-xs font-semibold uppercase text-gray-500">{auctionType==="rfa"?"Qualifying":"UFA Timer"}</label>{auctionType==="rfa"?<label className="flex h-11 cursor-pointer items-center gap-3 rounded-lg border border-gray-300 px-3 dark:border-gray-700"><input type="checkbox" checked={rfaQualified} onChange={e=>setRfaQualified(e.target.checked)} className="h-5 w-5 rounded border-gray-300 text-brand-500"/><span className="text-sm font-semibold">Qualified · ${requiredQualifyingAav.toLocaleString()} / 1 year</span></label>:<div className="flex h-11 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-700">60 seconds · resets to 45 when below 45</div>}</div>
            {auctionType==="rfa"&&<div><label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Auction Result</label><div className={`flex h-11 items-center rounded-lg border px-3 text-sm font-medium ${rfaQualified?"border-violet-200 bg-violet-50 text-violet-700":"border-brand-200 bg-brand-50 text-brand-700"}`}>{rfaQualified?"90-second blind RFA":"60-second open UFA"}</div></div>}
          </div>
          <button type="button" onClick={()=>void handleNominate()} disabled={!selectedPlayer||savingAuction} className="mt-4 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{savingAuction?"Nominating…":"Nominate Player"}</button>
          {auctions.filter(a=>!["completed","cancelled"].includes(a.status)).length>0&&<div className="mt-6"><h3 className="mb-2 font-semibold">Active auction controls</h3><div className="space-y-2">{auctions.filter(a=>!["completed","cancelled"].includes(a.status)).map(a=>{const rfaSealed=a.auction_type==="rfa"&&a.status==="open";const expired=new Date(a.ends_at).getTime()<=Date.now();return <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{a.player_season?.player?.full_name} {a.paused_at&&<span className="ml-2 rounded-full bg-warning-50 px-2 py-0.5 text-[10px] font-bold uppercase text-warning-700">Paused</span>}</p><p className="text-xs uppercase text-gray-500">{a.auction_type} · {a.status.replace(/_/g," ")} · {a.paused_at?`${a.paused_seconds_remaining||0}s remaining`: `ends ${new Date(a.ends_at).toLocaleString()}`}</p>{rfaSealed&&<p className="mt-1 text-xs font-medium text-violet-600">Offers are sealed. Bid count and details are hidden until reveal.</p>}</div>{a.status==="open"&&<div className="flex gap-2"><button onClick={()=>void handlePauseAuction(a)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${a.paused_at?"bg-success-600 text-white":"border border-warning-300 bg-warning-50 text-warning-700"}`}>{a.paused_at?"Resume Timer":"Pause Timer"}</button><button disabled={rfaSealed&&!expired} onClick={()=>void handleCloseAuction(a.id)} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">{rfaSealed?"Reveal Offers":"Close Bidding Now"}</button></div>}</div>})}</div></div>}
          <div className="mt-8">
            <div className="mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-white">Auction Log</h3>
              <p className="text-sm text-gray-500">Every nomination and its complete bid history. Removing an auction also removes its bid records.</p>
            </div>
            {auctions.length===0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No auctions have been recorded for this season.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Nominated</th>
                      <th className="px-3 py-2 text-left">Player</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Bids</th>
                      <th className="px-3 py-2 text-left">Complete Bid Log</th>
                      <th className="px-3 py-2">High / Winning Offer</th>
                      <th className="px-3 py-2">Result</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {auctions.map(a=>{
                      const sealed=a.auction_type==="rfa"&&a.status==="open";
                      const ranked=[...a.auction_bids].sort((x,y)=>y.aav-x.aav||y.years-x.years||x.created_at.localeCompare(y.created_at));
                      const offer=a.winning_bid||ranked[0];
                      const expired=a.status==="open"&&!a.paused_at&&new Date(a.ends_at).getTime()<=Date.now();
                      return (
                        <tr key={a.id} className="align-top">
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-500">{new Date(a.created_at).toLocaleString()}</td>
                          <td className="whitespace-nowrap px-3 py-3 font-medium">{a.player_season?.player?.full_name||a.player_name}</td>
                          <td className="px-3 py-3 text-center uppercase">{a.auction_type}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-center capitalize">{expired?"Expired — close required":a.paused_at?"Paused":a.status.replace(/_/g," ")}</td>
                          <td className="px-3 py-3 text-center font-semibold">{sealed?"Sealed":a.auction_bids.length}</td>
                          <td className="min-w-64 px-3 py-3">
                            {sealed?<span className="text-xs font-medium text-violet-600">Hidden until the admin reveals offers</span>:ranked.length===0 ? "—" : (
                              <div className="space-y-1.5">
                                {ranked.map((bid,index)=>(
                                  <div key={bid.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md bg-gray-50 px-2 py-1.5 text-xs dark:bg-gray-800">
                                    <span className="font-medium text-gray-800 dark:text-gray-100">
                                      {index+1}. {bid.fantasy_team?.team_name||bid.fantasy_team?.abbreviation||"Team"}
                                      {bid.is_qualifying_bid&&<span className="ml-1 text-gray-500">(qualifying)</span>}
                                    </span>
                                    <span className="whitespace-nowrap font-semibold">${bid.aav.toLocaleString()}</span>
                                    <span className="whitespace-nowrap text-gray-500">{bid.years} {bid.years===1?"year":"years"}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-center">{sealed?"Sealed":offer?`${offer.fantasy_team?.abbreviation||"Team"} · $${offer.aav.toLocaleString()} · ${offer.years}yr`:"—"}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-center capitalize">{a.resolution?.replace(/_/g," ")||"Pending"}</td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex flex-col gap-2">{a.status==="completed"&&a.pre_award_player_seasons&&!a.award_undone_at&&<button type="button" onClick={()=>void handleUndoAuction(a)} className="rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-xs font-semibold uppercase text-warning-700 transition hover:bg-warning-100">Undo Result</button>}<button type="button" onClick={()=>void handleRemoveAuction(a)} className="rounded-lg border border-error-200 px-3 py-2 text-xs font-semibold uppercase text-error-600 transition hover:bg-error-50 dark:border-error-500/40 dark:text-error-300 dark:hover:bg-error-500/10">Remove</button></div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              Display Names
            </p>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Edit user display names
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  User
                </label>
                <select
                  value={selectedDisplayProfileId}
                  onChange={(event) => handleSelectDisplayProfile(event.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">Choose a user</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.email || profile.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Display Name
                </label>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Charles F."
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveDisplayName}
              disabled={savingProfile || !selectedDisplayProfileId}
              className="h-11 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingProfile ? "Saving..." : "Save Display Name"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              {editingAssignmentId ? "Edit Assignment" : "Create Assignment"}
            </p>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingAssignmentId
                ? "Change this user's fantasy team"
                : "Assign a user to a fantasy team"}
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  User
                </label>
                <select
                  value={selectedProfileId}
                  onChange={(event) => setSelectedProfileId(event.target.value)}
                  disabled={editingAssignmentId !== null}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">Choose a user</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {getProfileLabel(profile)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Fantasy Team
                </label>
                <select
                  value={selectedTeamId}
                  onChange={(event) => setSelectedTeamId(event.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                >
                  <option value="">Choose a team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.team_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
              <button
                type="button"
                onClick={handleSaveAssignment}
                disabled={!selectedProfileId || !selectedTeamId || savingAssignment}
                className="h-11 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAssignment
                  ? "Saving..."
                  : editingAssignmentId
                  ? "Update Assignment"
                  : "Save Assignment"}
              </button>
              {editingAssignmentId && (
                <button
                  type="button"
                  onClick={handleClearAssignmentForm}
                  className="h-11 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-gray-800 dark:text-gray-300"
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                User Team Assignments
              </p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {selectedSeason} Auction Access
              </h2>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {assignments.length} Assigned
            </span>
          </div>

          {assignments.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              No users are assigned to teams for this season yet.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <th className="px-3 py-3">User</th>
                    <th className="px-3 py-3">Email</th>
                    <th className="px-3 py-3">Team</th>
                    <th className="px-3 py-3">Role</th>
                    <th className="px-3 py-3">Season</th>
                    <th className="px-3 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {assignments.map((assignment) => (
                    <tr key={assignment.id} className="text-gray-700 dark:text-gray-300">
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white">
                        {getAssignmentUserLabel(assignment)}
                      </td>
                      <td className="px-3 py-3">
                        {assignment.profile?.email || assignment.user_email || "Not set"}
                      </td>
                      <td className="px-3 py-3">
                        {assignment.fantasy_team?.team_name || "Unknown team"}
                      </td>
                      <td className="px-3 py-3 capitalize">
                        {assignment.role.replace("_", " ")}
                      </td>
                      <td className="px-3 py-3">{assignment.season_year}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditAssignment(assignment)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-gray-800 dark:text-gray-300"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAssignment(assignment)}
                            disabled={deletingAssignmentId === assignment.id}
                            className="rounded-lg border border-error-200 px-3 py-1.5 text-xs font-semibold text-error-600 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-error-500/30 dark:text-error-300 dark:hover:bg-error-500/10"
                          >
                            {deletingAssignmentId === assignment.id
                              ? "Removing..."
                              : "Unassign"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
