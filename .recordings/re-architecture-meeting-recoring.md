# **✍️ Quick notes**

*Please **rate the new Quick notes tab** by taking a [short survey](https://google.qualtrics.com/jfe/form/SV_5bXzKQfylMIhSXc?confid=rpSZrwdgsM-HRKa4iDREDxIVOBEQAjIGCIoCIAAYAQg&entryPoint=footerQuickNotes&isGoogler=False).*

## 

## **Oracle and Dunphen  DeepDive**

Sep 20, 2026  
[Joaquin Rodriguez](mailto:joaquin.rodriguez@elephant.xyz) [Mykyta Ovsiienko](mailto:mykyta.ovsiienko@elephant-labs.xyz)

Oracle pipeline and GitHub workflows and legacy data remining.

## **Oracle Pipeline Architecture and Data Integrity**

* The current Oracle pipeline lacks proper data structuring and relationships, compromising the technical foundation.  
* Storing large aggregated files creates excessive data refresh costs and performance bottlenecks.  
* Proposed generating parquet files per table per county to optimize storage and retrieval efficiency.

## **Decentralized Data Publishing and Version Control**

* Adopted GitHub PR workflows to manage updates, prevent parallel conflicts, and validate schema integrity.  
* Verified GitHub PR merges will automatically update IPNS pointers for decentralized data consumers.  
* Utilizing IPNS names as an interface enables consumers to query specific counties and data groups.

## **Historical Data Remining**

* Agreed to remine historical data to enforce strict compliance with the lexicon format.  
* Targeted 18,000 properties across Florida counties specifically to support the Open Door project.

## **Agent architecture and local mining**

* Local mining was tested to verify accessibility and cross-platform deployment across Azure, GCP, and local environments.  
* Agent modifications involve updating markdown files, while MCP changes require specific code adjustments.

## **Meeting recording access permissions**

* Google Meet sessions initiated via chat features restrict recording access permissions for participants.  
* Scheduling meetings directly through the calendar ensures proper recording access distribution.

## **Next steps**

- [ ] \[The group\] Update Website: Add a tab to the company website that displays a list of all available counties and data groups to monitor progress.  
- [ ] \[Soofi Safavi\] Approve Updates: Review and approve incoming pull requests to ensure oracle data integrity before triggering updates to the IPNS.  
- [ ] \[Mykyta Ovsiienko\] Refactor Oracle: Modify the oracle pipeline to generate parquet files per table per county and validate them against the lexicon.  
- [ ] \[Joaquin Rodriguez\] Send Property List: Provide the list of 18,000 properties to Mykyta.  
- [ ] \[Mykyta Ovsiienko\] Modify Agent: Update the agent to incorporate the 18,000 properties for Open Door.  
- [ ] \[Mykyta Ovsiienko, Joaquin Rodriguez\] Conduct Handoff: Perform the agent handoff session at 11:00 a.m.  
- [ ] \[Soofi Safavi\] Solve Recording Issue: Research and resolve the issue with recording access for meeting participants.

**Want to see more?** [View the full notes]()  
Tip: You can always access your full notes from the left sidebar.

*You should review Gemini's notes to make sure they're accurate. [Get tips and learn how Gemini takes notes](https://support.google.com/meet/answer/14754931)*

# **📝 Full notes**

Sep 20, 2026

## **Oracle and Dunphen  DeepDive**

Invited [Joaquin Rodriguez](mailto:joaquin.rodriguez@elephant.xyz) [Mykyta Ovsiienko](mailto:mykyta.ovsiienko@elephant-labs.xyz)

Attachments [Oracle and Dunphen  DeepDive](https://calendar.google.com/calendar/event?eid=MGIwbm9kaDNlcDhsbmlyaTdydmUzNzZ0M3MgY19mYmQyYmViZGExMWJkNmYyMDUyZmM0YzJkMTZlMDdjNmYxNjFmYzdjY2YxYzMzZTc1ZTUyNmRkOGIzMzE3YWMxQGc)

Meeting records [Transcript](https://docs.google.com/document/d/15afMyGLqIMi4-Yv0qFuwuF_QfQb62PROBgUiwxFplWk/edit?usp=drive_web&tab=t.y87yc22dsuy) *(Some recordings unavailable)*

### **Summary**

Oracle pipeline and GitHub workflows and legacy data remining.

**Oracle Architecture and Data Integrity**  
Discussion on Oracle pipeline integrity and IPFS publishing issues. Consensus reached to use GitHub pull requests for version control.

**Remining Legacy Data**  
Decision made to remine 18,000 legacy properties across Florida counties for the Open Door project.

### **Decisions**

## Aligned

* **Parquet file organization by county** The participants aligned on structuring parquet files by table per county to optimize data retrieval and storage size.

* **GitHub pull requests for data registration** The group agreed to use GitHub pull requests to manage data registries and prevent parallel update conflicts.

* **IPNS publishing via GitHub validation** Participants agreed to validate data through GitHub pull requests prior to publishing updates to a single master IPNS name.

* **Remining of existing legacy data** The team aligned on remining all existing data that is not formatted in accordance with the lexicon.

### **Next steps**

- [ ] \[The group\] Update Website: Add a tab to the company website that displays a list of all available counties and data groups to monitor progress.

- [ ] \[Soofi Safavi\] Approve Updates: Review and approve incoming pull requests to ensure oracle data integrity before triggering updates to the IPNS.

- [ ] \[Mykyta Ovsiienko\] Refactor Oracle: Modify the oracle pipeline to generate parquet files per table per county and validate them against the lexicon.

- [ ] \[Joaquin Rodriguez\] Send Property List: Provide the list of 18,000 properties to Mykyta.

- [ ] \[Mykyta Ovsiienko\] Modify Agent: Update the agent to incorporate the 18,000 properties for Open Door.

- [ ] \[Mykyta Ovsiienko, Joaquin Rodriguez\] Conduct Handoff: Perform the agent handoff session at 11:00 a.m.

- [ ] \[Soofi Safavi\] Solve Recording Issue: Research and resolve the issue with recording access for meeting participants.

### **Details**

* **Oracle Ingest Process and IPFS Publishing**: Joaquin Rodriguez raised a collaborator story regarding the Oracle ingest process, noting that currently, after transforming files and using the lexicon to map the graph, Oracle only publishes parquet files to IPFS rather than publishing the graph itself. Mykyta Ovsiienko and Joaquin Rodriguez ([00:00:40](#00:00:40)) discussed modifying the process to publish graphs, convert parse links into CID links, pin blocks in Filebase, keep zips private, and publish a small index pointing the county catalog at the index. Soofi Safavi ([00:02:32](#00:02:32)) noted that the current Oracle implementation lacks Merkle trees and proper relationships, functioning merely as a file cascade.

* **Oracle Architecture Integrity and File Structure Concerns**: Soofi Safavi argued that the entire Oracle pipeline integrity is compromised due to disconnects between Merkle trees, IPFS files, and Master Control Program parquet files, warning that adding property management as isolated files breaks the data network. Mykyta Ovsiienko ([00:04:34](#00:04:34)) explained that having one file per data group was implemented to avoid Pinata billing issues caused by millions of individual API retrieval requests. Soofi Safavi ([00:07:00](#00:07:00)) and Mykyta Ovsiienko discussed how parquet files serve as aggregate indices consumed by MCP, while Mykyta Ovsiienko ([00:09:12](#00:09:12)) noted that existing JSON files lack source HTTP requests and essential keys.

* **Development Process and Architectural Accountability**: Soofi Safavi criticized past changes that removed Amazon Web Services dependencies from the Oracle node without reviewing architectural consequences, stating that code changes are frequently made without understanding underlying data structures. Mykyta Ovsiienko ([00:11:13](#00:11:13)) ([00:21:39](#00:21:39)) acknowledged removing AWS and failing to review architectural changes or care adequately about the codebase. Soofi Safavi ([00:12:27](#00:12:27)) ([00:17:55](#00:17:55)) expressed strong frustration with sloppy engineering practices, lack of founder attitude across the team, and broken architectures in projects like QC, emphasizing that team members must care about the company's foundational integrity rather than just rushing timelines ([00:14:58](#00:14:58)) ([00:19:36](#00:19:36)).

* **Master Control Program and Indexing Setup**: Soofi Safavi and Mykyta Ovsiienko ([00:22:40](#00:22:40)) discussed the MCP concept, establishing that parquet files act as a reverse index stored on public infrastructure. Mykyta Ovsiienko clarified that MCP consumers download parquet files to provision a local or AWS-hosted database for fast data retrieval. Soofi Safavi explained that users configure their MCP by pulling these public index files depending on their consumption scale, while Mykyta Ovsiienko ([00:23:57](#00:23:57)) noted that ongoing processes must exist to refresh and retrieve latest files.

* **Data Scaling and Refresh Feasibility**: Soofi Safavi questioned whether storing 150 million property references in massive IPFS parquet files is architecturally feasible regarding download speeds and gateway limits. Mykyta Ovsiienko ([00:25:23](#00:25:23)) responded that parquet files store actual tabular data rather than millions of individual references, making downloads relatively cheap. However, Mykyta Ovsiienko and Soofi Safavi ([00:27:51](#00:27:51)) debated the efficiency of redownloading large parquet files (potentially 100 GB) for frequent data refreshes like daily permits, with Mykyta Ovsiienko ([00:29:07](#00:29:07)) noting that practical testing is required to verify provider limits.

* **Data Group Linking and Contractor Lookup**: Soofi Safavi ([00:30:26](#00:30:26)) highlighted search scaling problems and the lack of explicit links between data groups, such as connecting permit data to contractor business data. Mykyta Ovsiienko suggested provisioning database tables per class during MCP setup to enable SQL joins. However, Soofi Safavi ([00:31:46](#00:31:46)) pointed out that Oracle currently treats contractor names as plain text without persistent identities, demanding that Oracle perform lookups against existing contractor tables to include consistent CIDs. Mykyta Ovsiienko ([00:33:27](#00:33:27)) agreed that consistent hashing should naturally preserve CIDs if identical records are produced.

* **IPNS Names and GitHub Registry Integration**: Soofi Safavi and Mykyta Ovsiienko ([00:36:11](#00:36:11)) discussed avoiding blockchain dependency by utilizing InterPlanetary Name System names and GitHub registries. Soofi Safavi proposed publishing approximately 200 class CIDs or county-specific table CIDs on GitHub to mirror blockchain efficiency. Mykyta Ovsiienko calculated that scaling across 3,000 counties and 200 objects would generate around 600,000 files, prompting agreement that county-level parquet files would prevent monolithic data bloat ([00:37:20](#00:37:20)).

* **County Updates and Concurrent Pull Requests**: Mykyta Ovsiienko and Soofi Safavi ([00:40:38](#00:40:38)) addressed how to handle file updates when processing multiple counties concurrently without losing data. Mykyta Ovsiienko proposed using GitHub pull requests to register new counties and update a master list, preventing parallel update conflicts and deleted records. Soofi Safavi ([00:42:03](#00:42:03)) and Mykyta Ovsiienko ([00:43:19](#00:43:19)) agreed that GitHub pull requests provide ideal version control and observability, after which MCP consumers can specify desired counties and tables to minimize downloads.

* **Name Interfaces and Decentralized Architecture Debate**: Soofi Safavi ([00:46:20](#00:46:20)) ([00:50:30](#00:50:30)) argued that human-readable name interfaces (similar to the Domain Name System and IPNS names) are foundational for consumers like Open Door, allowing users to query data intuitively by county and data group (e.g., HOA data for Lee County). Mykyta Ovsiienko ([00:46:20](#00:46:20)) ([00:49:14](#00:49:14)) expressed initial skepticism toward name interfaces and managing 600,000 IPNS names, but Soofi Safavi ([00:50:30](#00:50:30)) emphasized that name-based interfaces are essential for non-technical users and represent the core genius of decentralized internet architecture.

* **Validated IPNS Publishing via GitHub Control**: Soofi Safavi ([00:54:39](#00:54:39)) and Mykyta Ovsiienko ([00:55:56](#00:55:56)) established a hybrid consensus workflow for data publishing: developers submit validated Oracle data via GitHub pull requests, giving administrators observation and approval control. Once approved, the system automatically triggers updates to IPNS names ([00:54:39](#00:54:39)), ensuring consumers access valid, lexicon-compliant data through a single stable IPNS namespace without name squatting risks ([00:55:56](#00:55:56)).

* **Remining Existing Data for Open Door**: Mykyta Ovsiienko ([00:56:56](#00:56:56)) raised the question of how to handle legacy mined data that lacks proper lexicon formatting. Soofi Safavi decided that all legacy data must be remined, specifically targeting 18,000 properties across Florida counties required for the Open Door project. Joaquin Rodriguez agreed to provide the property list to Mykyta Ovsiienko ([00:58:10](#00:58:10)), who will modify the mining agent to execute the updates locally or on AWS.

* **Local Mining and Cross-Platform Deployment**: Mykyta Ovsiienko tested local mining to demonstrate accessibility and noted that the agent is designed to be cross-platform, allowing deployment to Azure, local environments, and Google Cloud Platform ([00:59:24](#00:59:24)).

* **Agent and Model Context Protocol Modifications**: Mykyta Ovsiienko explained that making changes to the agent is straightforward because it uses markdown files, but they still need to check what modifications are required in the Model Context Protocol to process 18,000 items ([00:59:24](#00:59:24)).

* **Workflow Handoff to Joaquin Rodriguez**: Soofi Safavi requested that Mykyta Ovsiienko hand off the 18,000 items process to Joaquin Rodriguez—who interfaces with Open Door—after completing the initial run so that Joaquin Rodriguez can redo the work and understand the entire workflow ([00:59:24](#00:59:24)). Mykyta Ovsiienko scheduled a calendar invite for the handoff at 11:00 AM San Francisco time, which Joaquin Rodriguez confirmed works for them after resolving a computer freeze ([01:00:30](#01:00:30)).

* **Google Meeting Recording Accessibility**: Mykyta Ovsiienko raised an issue regarding Google meeting recordings, stating that recordings from meetings created via chat slash-meet commands are not properly accessible and lack access past August 25\. Soofi Safavi clarified that participants listed on calendar invites receive recording access by design, suggested scheduling all calls through the calendar to avoid the issue, and offered to specifically send the current recording to Mykyta Ovsiienko if necessary ([01:02:52](#01:02:52)).

*You should review Gemini's notes to make sure they're accurate. [Get tips and learn how Gemini takes notes](https://support.google.com/meet/answer/14754931)*

*How is the quality of **these specific notes?** [Take a short survey](https://google.qualtrics.com/jfe/form/SV_5bXzKQfylMIhSXc?confid=rpSZrwdgsM-HRKa4iDREDxIVOBEQAjIGCIoCIAAYAQg&detailLevel=standard&hasImages=False&entryPoint=footerMain&isGoogler=False) to let us know your feedback, including how helpful the notes were for your needs.*

# **📖 Transcript**

Sep 20, 2026

## **Oracle and Dunphen  DeepDive \- Transcript**

### **00:00:40** {#00:00:40}

**Mykyta Ovsiienko:** Hey.

**Joaquin Rodriguez:** Hey, how's it going? Well, Soofi,I don't know if you're there. All right. Either way, did you um there's a story that I um added you as a collaborator. I don't know if you got a chance to look at it.

**Mykyta Ovsiienko:** No, I haven't. Let me check it right now.

**Joaquin Rodriguez:** Okay, I'll put the link in the chat. Let me share my screen.

**Mykyta Ovsiienko:** Mhm.

**Joaquin Rodriguez:** So basically in the ingest process for Oracle when it transforms the files and then it uses the lexicon to map the graph it doesn't publish it to IPFS it only publishes the parquet files and then um that's where it ends. So we don't have the visibility of the graph on IPFS. So the idea is to uh change the process for the oracle to publish that as well.

**Mykyta Ovsiienko:** Okay. After zip for data files, turn parse links into CD links and pin those blocks and file base. Keep the zip private.

**Soofi Safavi:** Keep off.

**Mykyta Ovsiienko:** Keep petting and JSON.

### **00:02:32** {#00:02:32}

**Mykyta Ovsiienko:** Publish a small index follow point the county catalog at the index. Same C on the project row. Okay. What does keep the Z private means from the description?

**Joaquin Rodriguez:** Um, not too Sure. Is it a private? I guess the the file that it generates on on the local device. I'm assuming that's what it means.

**Mykyta Ovsiienko:** If you publish it to IPFS, it becomes public.

**Soofi Safavi:** But but just let let's not let's not uh um argue about this like what is in Oracle right now this does not actually

**Mykyta Ovsiienko:** Okay.

**Soofi Safavi:** follow any of the things that actually we have there is not a miracle tree there is no relationship there there's nothing in IPFS you just have a dump of a file that is basically that is a cascade uh of everything so the question is what have we done to the Oracle process in a sense and what is the role of the IPFS

**Mykyta Ovsiienko:** Let me check it.

**Soofi Safavi:** Can you guys hear me still?

**Mykyta Ovsiienko:** Yeah. Yeah.

### **00:04:34** {#00:04:34}

**Joaquin Rodriguez:** Yeah.

**Soofi Safavi:** the entire um integrity of the whole Oracle

**Joaquin Rodriguez:** Heat. Let's

**Soofi Safavi:** pipeline it seems it's actually is compromised

**Joaquin Rodriguez:** go.

**Soofi Safavi:** which the Merkel tree and you know the the CIS and and everything else and then when we are putting these into the MCP or just try to populate the paret files. It's just like there there's the disconnect. There's a bunch of files in IPFS that just has nothing to do with anything which is not the intent of the actually the the whole architecture.

**Mykyta Ovsiienko:** Yeah, I'm taking it now. Never a moment. E remember that we made a change to have one file per property instead of a lot of files but other than that yeah I agree that architecture should have stay the

**Soofi Safavi:** Oh, but but how do we have one fer property? Like we are adding new data groups. These things they need to be linked. Like like it just right now we have added property management as another one like just that doesn't make sense like the whole thing is actually this is a this is a network of data like we basically this this one file is compromising the entire the entire evolution of actually of uh of of the graph.

### **00:07:00** {#00:07:00}

**Soofi Safavi:** Yes.

**Mykyta Ovsiienko:** Yeah, it should be probably one file per data group. The reason we did that is to avoid issue we had uh this cost on pinata

**Soofi Safavi:** I know.

**Mykyta Ovsiienko:** because it was caused by having millions of files.

**Soofi Safavi:** Like we But we pretty much just made this thing. It's actually doesn't do what it's supposed to do. Like it's And there there was no point like we then what how do we even know what these files are like what's the point of it the the structure is the data goes into IPFS and then we use now uh use the Dunphento basically to index it. But just this means to be linked to each other. And then the the co but the cost that now how how does the cost calculated when we write is by amount of data that you pin. Okay.

**Mykyta Ovsiienko:** It is amount of data and counts of data but count of files. The biggest issue we had when we were trying to retrieve it because we were built per request.

### **00:09:12** {#00:09:12}

**Mykyta Ovsiienko:** Each file was becoming a request and our biggest part of the bill in Piñata was those API request to retrieve.

**Soofi Safavi:** But how does that that was but that was pinata and the retrieval was actually was the index.

**Mykyta Ovsiienko:** Yep.

**Soofi Safavi:** So how does that now in the current architecture because independent from that we are creating these parquet files which ultimately is one aggregate linked to everything that ultimately is like an index and that index is one file that ultimately I'll suck into the MCP and then when I find what is it that I'm looking for then I go and grab have that that that that objects or whatever is associated.

**Mykyta Ovsiienko:** Yeah,

**Soofi Safavi:** Is that correct?

**Mykyta Ovsiienko:** I'm checking it should be like I'm trying to understand where the spark files comes from right now and how are those updated? it. Yeah. Also, I just opened JSON file. I don't think it follows like second that we had.

**Soofi Safavi:** No, it doesn't.

**Mykyta Ovsiienko:** And it's just a bunch of keys. It doesn't have source HTTP request.

### **00:11:13** {#00:11:13}

**Mykyta Ovsiienko:** It doesn't have nothing.

**Soofi Safavi:** And I I understand where this come from because when whoever that dude was made these changes, but where I don't understand the last change that they made, they said, "Let's update the Oracle, not to use the node. Everything should be there." Like h how how did we even like why you're surprised right now? because we did the you did the last round of this to just basically make sure that we have one consolidated Oracle agent that the assumption was everything that it was the Oracle node and everything is in here which It's like the whole thing is broken.

**Mykyta Ovsiienko:** Yeah, when I was doing it, yeah, just made sure that it runs without AWS. I wasn't checking what is architecture we have.

**Soofi Safavi:** I know. But just But we got to stop doing that.

**Mykyta Ovsiienko:** Yeah.

**Soofi Safavi:** When we make a change, we just see it doesn't do what it's supposed to do. Like like this this is exactly our problem. It's just basically that's how Mario's right now built things because he has no idea what this is.

### **00:12:27** {#00:12:27}

**Soofi Safavi:** So you just give him something, he goes and basically makes changes and never look at the data like we just need to look at these transactions to just say if I do this would it produce what it's supposed to do.

**Mykyta Ovsiienko:** together. masteration. I'm sure that back Okay. Okay. So, so what do what did it do? We want to right now agree at what it should be and then we change

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** that.

**Soofi Safavi:** But but another problem that I have is just basically right now we gave this to every single candidate. We have done many demos. We have made any changes like and you know Joaquinneeds to go and unexplained in this. You're not explaining this to anyone. So as a coach nobody like you interact with these guys they have zero understanding. You just get on these calls. Every time they have a question for you, you just made some changes and just say, "Go, go, go. It's over there." Right?

### **00:14:58** {#00:14:58}

**Mykyta Ovsiienko:** Yep.

**Soofi Safavi:** So my issue is not allowed to change. My issue is the role that actually you play in these in these critical things that it can't just basically no not only we make people smarter, we break things and then we ignore and then we just let it go forever.

**Mykyta Ovsiienko:** Never.

**Soofi Safavi:** Yeah. So, so that is the issue that I have like that can't be the case like we just need to be it's like I I I don't know it's just like what what what we think to be able to do this like if we cannot make these changes and we want to do sloppy work you should not do that like there's no time constraints on these things just need to you need to give a s\*\*\* to just basically just say what is the consequence of these things that you're that is the issue like we are we are selling this this is the foundation of everything that we are actually right now I'm doing with open door with this with that and it's I'm sitting on a foundation of s\*\*\* That is the issue.

### **00:16:30**

**Soofi Safavi:** I don't want to make changes because I I don't trust anyone to just actually even give a s\*\*\* to make a change. But we spend all this time, energy, like these new guys, they came in, we just put him on that. It's just that for nothing. Like how how could that be? Like where where does this go wrong in our process that is that is so f\*\*\*\*\* up?

**Mykyta Ovsiienko:** Yeah, I just uh didn't care that much if cared about elephant. I guess hands down in SOC some changes to elephant.

**Soofi Safavi:** No,

**Mykyta Ovsiienko:** We're making this that and I'm just

**Soofi Safavi:** but just as we can like that's that's that's not a that's not a you know founder attitude. That that's not a founder attitude. It's just like we just it can't be. That's the attitude of Jacob who just showed up for a month. He has no idea. I I do not expect that from you. I do not expect that from S. I don't expect that from Aya.

### **00:17:55** {#00:17:55}

**Soofi Safavi:** I don't expect that from guitar. And then the problem is what you guys teaching the new athletes. You you make them you make them ignorant as actually from the beginning. The reason is clueless about this process is because of you guys. Well, Kim is actually doesn't know anything. But yet, right now for for three weeks, you're paying me random. He's involved. Sean is involved. Storm is involved to go do Florida. We have open door projects, all of these things. And because at some point you didn't care, you just have this cascade of s\*\*\* that is actually by love. But it can be and and it's and and it's just a matter of caring because if you care you you basically say you know right now you're focusing on SOC can't do this the same way yesterday I asked you to do something you say no now look tomorrow I'm I'm drunk right it's the same you have to you can't let the cherry ing though regardless of actually regardless of what timeline and the projects that we have because that is the root of of the whole thing.

### **00:19:36** {#00:19:36}

**Soofi Safavi:** It's just that's the root of when you guys get on the call with James and Veritus it we we end up with a pile of s\*\*\* like the entire QC project it's basically is a waste two projects you're involved I were involved neither of You guys caught the fact that actually like architecturally we can't just put s\*\*\* the entire QC project. It has new person object like they're not using lexicon. All the things that they've done is not even linked to the actually to the data that they have. Those are the things that we just cannot cannot have. Like these are not timeline. This is just purely caring. purely caring to just say, "Is this is this gonna actually compromise the integrity of our foundation as a company which you're part owner of. Make sense? And then you need to pay it forward. Like you just need to you if doesn't know these things, you should care because he's executing on your vision. If he fail, you fail. If you fail, I fail.

### **00:21:39** {#00:21:39}

**Soofi Safavi:** If I fail, you fail.

**Mykyta Ovsiienko:** Yeah. Yeah. Which is not even my vision anymore. Yeah. Because I didn't care to review whatever the changes were. Yeah.

**Soofi Safavi:** But and and that's that's compromising because now if you got a new client when we get a new client what happens the value of collective company going to go up like it's I always say this is not a job. If you want to do a job, just go get a job. And that that job is basically when they need you, they need you. I don't know need you. You go to the next one. This is not this is not it's just I I treat us as actually as as a family. Treat us as actually as is always here. We go down together. We come up together. That that is that is the that is the point.

**Mykyta Ovsiienko:** Yeah. Yeah, I know, right?

**Soofi Safavi:** So, so let's let's let's not do so couple of things we need to do.

### **00:22:40** {#00:22:40}

**Soofi Safavi:** Oracle needs to happen then this concept of the MCP is not understood by anyone because that dude did it and I I can't even ex understand conceptually but my assumption is the the the park files it operates like an index. Does that make sense? Thank you.

**Mykyta Ovsiienko:** Yeah, I mean you my assumption was when you stood up an MCP, you quickly do indexing on the data we have then your MCP is backed by the database that can allow you to quick to easily retrieve the data. So when you stood up the MCP, you're getting you're building index based up files.

**Soofi Safavi:** But but it's not it's not you as basically as someone who consume it. This is done as part of the Oracle process that it says for entire object model that we have. There are already files that as the Oracle put one property, it goes and actually put that property into index one. When it put the HOA, it put the actually index into the HOA file. So, and those are on the IPFS.

### **00:23:57** {#00:23:57}

**Soofi Safavi:** So what happens is When I come in as the user of actually of this a as a consumer of data, all I do is basically I connect my actually my MCP to these files, which means anyone who who in the last 10 years put these files in there ultimately is going to basically be able to search. So it's a reverse of an index. index it makes it local to me.

**Mykyta Ovsiienko:** Mhm.

**Soofi Safavi:** This is actually create an index on a public infrastructure that anyone who shows up is actually consuming. Is that a correct?

**Mykyta Ovsiienko:** It is a dump of an index. So to make a database, you download those parket files,

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** you create a database from them and then you search on this database.

**Soofi Safavi:** Yeah. Yeah.

**Mykyta Ovsiienko:** Also one thing to make explicit when we're saying consumer of an MCP right now you need to host MCP somewhere you can host it locally you can provision in AWS

**Soofi Safavi:** Yeah, it it is just setting that up is basically is a one-time thing that when I come in as actually as user and I need to based on my consumption decide what is that if I'm farmers and I want to use this data I basically put that on on on AWS because I have a million users that is going to use the MCP.

### **00:25:23** {#00:25:23}

**Soofi Safavi:** If I'm Sufi, I won't do that. I'm just dump it on my actually computer because I just I'm doing local search.

**Mykyta Ovsiienko:** Yeah.

**Soofi Safavi:** But the the setting that up of actually of an MCP is consistent for both of them, which is go get these files and just basically bring it into your local.

**Mykyta Ovsiienko:** Yeah,

**Soofi Safavi:** Yes.

**Mykyta Ovsiienko:** it should be and then there should be some process of refreshing them getting latest files, getting new files.

**Soofi Safavi:** Yes.

**Mykyta Ovsiienko:** Yes.

**Soofi Safavi:** Well, and is this from a IPFS perspective? Because eventually these files, they're going to be massive, right? They're going to be 150 million references to actual IPFS in them.

**Mykyta Ovsiienko:** But we right now we don't we store parket files with the actual data. That's why you download 10 tables and you're done. And it is cheap. Get files doesn't store references

**Soofi Safavi:** I know. But even the references, they're going to be 150 million references eventually.

**Mykyta Ovsiienko:** because we'll have what you're saying. We will have 150 million property.

### **00:26:38**

**Mykyta Ovsiienko:** Therefore, we'll have 150 million.

**Soofi Safavi:** Yes. Yes.

**Mykyta Ovsiienko:** Yeah. as far as it.

**Soofi Safavi:** So is this is this sound like does this even actually possible? It does work for D challenging which is half half a million.

**Mykyta Ovsiienko:** Is this possible to do?

**Soofi Safavi:** But is this going to is this going to the architecturally is this feasible?

**Mykyta Ovsiienko:** to put 150 million rolls into one bracket file and host it on IPFS.

**Soofi Safavi:** And that I know it can be because it's IPFS,

**Mykyta Ovsiienko:** Yes.

**Soofi Safavi:** but getting that downloaded,

**Mykyta Ovsiienko:** Mhm.

**Soofi Safavi:** installed, and on a regular basis bring that from IPFS down to wherever my actually location like what would be the size of this file when it becomes 150 million. First of all, it's not going to be one. My assumption is is going to be very similar to the open search index that you're going to create which is going to be you know par 5 per object in a sense or per data group.

**Mykyta Ovsiienko:** one file that has all properties is for this data group.

### **00:27:51** {#00:27:51}

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** Yeah, I it is updating SA is wasteful process and because every time you want to update the data you redownload the whole dump of the data like whole packet files that has everything therefore yeah when it will become big let's say I don't know how big it can be but let's say 100 GB if we are downloading 100

**Soofi Safavi:** Mhm.

**Mykyta Ovsiienko:** gigabytes every hour is a lot of waste and it will be expensive That's

**Soofi Safavi:** But it's not I wouldn't say it's actually it's and the only time you're updating this is not that actually the data is updated in in a sense, right? because this has reference. Yeah, it's the data is updated because we have a new for data group, right? when it gets updated.

**Mykyta Ovsiienko:** also when we append more properties when we refresh data for existing property.

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** Just

**Soofi Safavi:** The the more more properties put it aside because that's not a frequent thing like the we're not adding every hour like every month maybe one county comes on just like that under on under on the new is not that is not the issue is on the refresh of the data is the issue.

### **00:29:07** {#00:29:07}

**Mykyta Ovsiienko:** Yeah. I'm going to be

**Soofi Safavi:** We're not getting new data but we're getting new permits. every day.

**Mykyta Ovsiienko:** Yeah.

**Soofi Safavi:** So the permit the permit or the improvement park file needs to be downloaded.

**Mykyta Ovsiienko:** Yeah. Over and over again. Yeah.

**Soofi Safavi:** And even if it is if it's let's say how long does it take to actually bring down 100 gig from from IPFS and does IPFS even allow that it through the gateways.

**Mykyta Ovsiienko:** Good question. Depends on your provider. Yeah, good question. It's so Theoretically it should since it splits data into the blocks yada yada yada. Practically speaking need to try

**Soofi Safavi:** But then I I would I would do that and just basically because it's a sustainable architecture. If you do that then it's got to be the end of the actually like we're going to end up putting all this data we're going to put that but it's not consumable right. It's like it becomes another architect.

**Mykyta Ovsiienko:** as as we always do.

### **00:30:26** {#00:30:26}

**Mykyta Ovsiienko:** Yeah.

**Soofi Safavi:** Yeah. So, so that's why I'm asking these questions right now just like before we stick to that we need to understand our

**Mykyta Ovsiienko:** Yeah. Yeah.

**Soofi Safavi:** use case and see you know this all all these architecture works when you have you know 100,000 transaction they shed the bed when you when you so they're not not our solutions are not scalable in a sense because we don't think what the consequences but the the second part of it which is which is important is how does this how Does this we have a search problem doesn't matter at search at scale right all the things that right now we talk about the graph and counts and everything else how does this how does this manifest itself that if inside the MCP I'm trying to I'm trying to link permit data to the contractor data there are two sources of actually information and I don't think even we have this data group somewhere when we add the sunbis to bring in I don't think you have a contractor the business data group

### **00:31:46** {#00:31:46}

**Mykyta Ovsiienko:** Yeah, we should have idea is that you bring two data groups those are two different parquet files because to stood up MCP you provision a database let's say locally it would be culite in AWS something more capable it will be different tables. Those are obviously should link each other and then when you query the data you do joints and because it is database it would be

**Soofi Safavi:** I Oh, I know. But they're they're linked at what level? Right. They're linked at the data group level, but not our searches. They're at the data group level. Right. So think about the HOA think think about improvement inside

**Mykyta Ovsiienko:** Mhm.

**Soofi Safavi:** improvement. I have contractor and I have actually the the the the permit information who did this per when I first of

**Mykyta Ovsiienko:** Never mind.

**Soofi Safavi:** all I should never in Oracle process do the improvement without the contractor database first which means I need to download that way I have a key for every single business. So when I looked that up because right now when you look at the improvement even in the previous Oracle this wasn't lint the business name was like a text which it's it's not it doesn't have an identity but we need to bring this on this down and then as we are getting these improvements the Oracle needs to do a lookup and says this contractor it is that contractor that it was there.

### **00:33:27** {#00:33:27}

**Soofi Safavi:** So when I actually put the contractor object, it should have the CID of the contractor from the previous.

**Mykyta Ovsiienko:** Yeah. Yeah, our idea was that you don't need to do a lookup because if you produce same contractors that then the same C because it is hash. Yeah. Then when you stood up MCP, you should have probably table not per data group but table per class. And then your process of creating an like provisioning MCP

**Soofi Safavi:** Uh so so that that is that there so that is so the architecture of doing this per

**Mykyta Ovsiienko:** should

**Soofi Safavi:** group is even incorrect because it doesn't link anything.

**Mykyta Ovsiienko:** I mean dumping everything in data groups I think is good. It's when you provision MCP you need to split it.

**Soofi Safavi:** No no it's it's when when we index it that that I'm 100% okay with the data group because the integrity inside the data group is preserved. You have from, you have to all of that is there like it's actually that that is closure but the index cannot be at the data book

### **00:34:29**

**Mykyta Ovsiienko:** by by saying index you mean when you provision MCP and database

**Soofi Safavi:** uh when we create the park file

**Mykyta Ovsiienko:** and we create parker files.

**Soofi Safavi:** is in the paret file is paret files I'm not scanning paret files or does the parquet file which at the end of the actually at the end of one transaction that I'm finished when I persist everything as as a data group then there 10 part there are 10 classes in my data there are 10 parquet files in IPFS I need to take that one class add it to the parket file that's how this this file gets updated as the oracle actually go through the process otherwise when the new person shows up needs to scan the entire IPFS which defeat the whole purpose of like I don't even know what to scan and these parade files they need to be pinned and they need to be published somewhere

**Mykyta Ovsiienko:** Correct.

**Soofi Safavi:** otherwise what do I know when I actually I come in just say download what from Does that make sense?

**Mykyta Ovsiienko:** Yeah. just let me want to see how right now this MCP discovers files.

### **00:36:11** {#00:36:11}

**Mykyta Ovsiienko:** So this is what from where is a good question. But now we avoided blockchain by using this IPNS which make which how then you get list of all

**Soofi Safavi:** Yep.

**Mykyta Ovsiienko:** IPNS names and also it limits what it does is we only have access to those IPNS names if someone else comes they cannot replace our APNS which I don't yeah which we made

**Soofi Safavi:** Yeah, that's what

**Mykyta Ovsiienko:** this tradeoff I wasn't happy about it didn't tell anyone are we okay with that or do we still preserve this publicity and that everyone can be an oracle publish the data

**Soofi Safavi:** Yeah,

**Mykyta Ovsiienko:** without

**Soofi Safavi:** we we should even Even we are not we are not doing that is we we are distributing that we just get a candidate to go basically the entire process and we said we'll do it in such a way that it's pinned under ours. So we still maintain the the the ownership of that. So this way it's available number one. Number two, I do think it's just simply we we're going to have 200 classes.

### **00:37:20** {#00:37:20}

**Soofi Safavi:** We need to put 200 CDs on on GitHub.

**Mykyta Ovsiienko:** Okay, next one.

**Soofi Safavi:** You just say this these are the these are the C ids that actually when you want to create an MCP, you need to pull in the information and this CD is B do do exactly what we did in blockchain. blockchain you would get the actually the it was per right and you could put it there. This might solve even the blockchain problem because if at the end we are putting the entire index on the blockchain ultimately we would have you would have 300 blockchain ids.

**Mykyta Ovsiienko:** We would uh we need not 200 tables because we would probably need to have one paret file per table per county or something like that cuz then If if you do if you have one table per all and multiple people do multiple

**Soofi Safavi:** Yeah, that's that's smart. That's smart.

**Mykyta Ovsiienko:** projects.

**Soofi Safavi:** I like that because and and this will solve your basically other problem that we you just said which is downloading massive files because now these files they're basically they're per county and I'm going to put a refresher schedule to pull that pull that in.

### **00:38:40**

**Mykyta Ovsiienko:** It will create a lot of files but not that much. How many counties?

**Soofi Safavi:** It's 3,000 times 200\.

**Mykyta Ovsiienko:** 3,000 \* 200 600,000 600,000

**Soofi Safavi:** Children can have 200 objects. Yes.

**Mykyta Ovsiienko:** files which if you download them once is yeah right now I'm checking how it is done right now we have one file that has all other pointers which is an issue as well.

**Soofi Safavi:** And then how so so that that's another and then how does it add to so imagine there is there there's one parking per county what whatever it is Sooficomes in and I start I I start the process of doing lee county I do the first property through the oracle it register that I update this file then the second I update it so I'm continuously changing the file so what does that what does that even mean in terms of in terms of the process like how how do I do that? For me to update the file, I need to have that file locally to add to it and then put it back on the IPFS

### **00:40:38** {#00:40:38}

**Mykyta Ovsiienko:** correct which doing it when you update every property would be extremely expensive. So right now architecture is that once you're done then you update the property

**Soofi Safavi:** which is which is fine.

**Mykyta Ovsiienko:** not property of fi file like once you're done with the whole county you update

**Soofi Safavi:** I think I think that's not a bad thing.

**Mykyta Ovsiienko:** that

**Soofi Safavi:** It's just basically you you would do that and just put it in there. But at the end of the Oracle, there should be some sort of a registration of this that is publicize it to just say my work is done. But by the way, I generate these 10 files 25\. And for now we need to maintain that ourselves. Maybe even under IP effects in a sense that we create one file which is the map and then we publish

**Mykyta Ovsiienko:** Yeah, which we have it right now. The only issue with that is when you're doing concurrent updates, let's you need to make sure that you're not losing whatever last person did.

**Soofi Safavi:** Um, say it again.

### **00:42:03** {#00:42:03}

**Mykyta Ovsiienko:** If we are doing two counties in parallel and you need to make sure that at the end both of them are presented in this file and not the one that you finished latest.

**Soofi Safavi:** I I don't I don't mind the the last part of that to be something that is that is centralized, right? Because you need to have a queueing. So, so there are two things every create one county is 100% independent because the parade file is independent everything else.

**Mykyta Ovsiienko:** Yeah.

**Soofi Safavi:** Now for for this to go online and it becomes available, we can have an API somewhere at the end of the process.

**Mykyta Ovsiienko:** Yeah. I even I think that GitHub solves this issue perfectly. You create you register a new account. You create a pull request to a file that has list of all the data. This way all those issues of parallel updates, conflicts, make sure that nothing is deleted is removed and then MCP reads from this file.

**Soofi Safavi:** That's fine. But it's actually these this this file is going to have it's going to have 600,000 object in it.

### **00:43:19** {#00:43:19}

**Soofi Safavi:** Is GitHub okay with that?

**Mykyta Ovsiienko:** Yeah,

**Soofi Safavi:** Oh yeah,

**Mykyta Ovsiienko:** it is 600,000 links. It is not actual objects.

**Soofi Safavi:** it's it's not it's with 600 SIDS in there and that's it. Okay. This will solve the problem.

**Mykyta Ovsiienko:** Okay. Then in Oracle you do the county you need to validate it against our lexicon. You publish those row JSON files resource HTTP request yada yada yada. You also create a parkhead file per table with all the entries all ids. You publish all of this. You create a pull request to GitHub. When you configure MCP, you specify which counties and what tables you want to consume so that you don't download all data if you don't need it. It consumes it from the GitHub. You create, you have an agent how to set up MCP. It reads those tables. It provisions a database based on where you want to host all of this. And then you use an MCP to query search geo queries stuff like that.

### **00:45:14**

**Mykyta Ovsiienko:** Yeah, maybe even MCP is wrong, but we'll keep it for now. Maybe we should have MCP and we should have just a server cuz when we are building those UIs, we need a server that is connected to database so you can submit your queries. Correct.

**Soofi Safavi:** But that is that is the client

**Mykyta Ovsiienko:** Yeah. I mean the right now our gateway to data is an MCP but what if you want to have a UI or whatever app then MCP is not the best standard to consume but I think it a separate problem we don't need to solve it for now

**Soofi Safavi:** Yeah, because they if they get these files, they can just put it into a pipeline, stick it into a table, right?

**Mykyta Ovsiienko:** yeah it just what you yeah what you do what I'm saying is it is what you do for MCP anyways you stick them into your tables yeah but Yeah,

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** for now let's focus on those GitHub those then we don't even need IPNS correct because if you update the data you make a pull request to GitHub with new CPNS

### **00:46:20** {#00:46:20}

**Soofi Safavi:** What is the

**Mykyta Ovsiienko:** is like name server but on top of IPFS I'm not sure how that works but I see that we had already issue with that that we run out of those APN PNS. It's like someone wanted to upgrade file base to some enterprise or pro because IPNS was created so that you can host your website on IPFS and you can update it. You have one name, one website, you update C I and you're fine. I don't think how we use IPNS was intended for that. And I'm worried that we might hit cost issues again or something. IPNS says like we have a name Lee County data group this and then we have C. When we updated Lee County we update C for this IPNS client still reads from this IPNS name. If you store anyway everything in GitHub, you can just store directly.

**Soofi Safavi:** I know but it's actually would that would that be a better architecture which is you know ultimately it is on the decentralized from an architecture perspective IPFS and IPNS is basically part of the same same decentralized architecture put put the cost per second aside you have because forget about you we need to have an account and not not not that it has a cost limitation but it's still we we we need to pay for it but it's at the

### **00:47:51**

**Soofi Safavi:** what I would call it a a permission construct f\*\*\*.

**Mykyta Ovsiienko:** Yeah, it does. She agreed that it is fine For this final step to have permission concept

**Soofi Safavi:** I know but it's it it is fine but I think it's unnatural to the decentralized model. I know it works but architecturally we are using we are using GitHub as a name server for IPFS which IPNS it's basically is for that Is it?

**Mykyta Ovsiienko:** what I'm saying is that we would still have a GitHub And we would point we would have pointers to IPNS names there. We still need registry of all the names somewhere. So why do we need to store name server to C if you can store C directly

**Soofi Safavi:** Um, I know. But the purpose of the purpose of this is for to give us a little bit of a control in terms of accepting the PR that somebody has actually has finished. But for a customer that we go tell them use this we don't need to go ask them to go to GitHub.

**Mykyta Ovsiienko:** They need to go to GitHub to know list of all the of everything that

### **00:49:14** {#00:49:14}

**Soofi Safavi:** But what's the why why can they go to the IP IPNS to do that?

**Mykyta Ovsiienko:** exists

**Soofi Safavi:** It's that's the whole point of the IPNS.

**Mykyta Ovsiienko:** cuz you need to have list of names even on IPs. Like how do you know where to get this data from? From what names? Well,

**Soofi Safavi:** But isn't that one address for the IPNS now?

**Mykyta Ovsiienko:** But what we have right now is you have for Lee County Elephant Lee County data APNS and elephant something other county APNS. So you will have as much 600,000 APNS names. You need to have a registry where to get all of them from. What are those names?

**Soofi Safavi:** or or a formula to just say what to get them, right?

**Mykyta Ovsiienko:** formula.

**Soofi Safavi:** It's it's it's like a it's like a website, right? All you need to know is like I'm just making that up, you know, elephant.xyz and then the formula for that is you want the the the it's public the definition of our data.

**Mykyta Ovsiienko:** Mhm.

### **00:50:30** {#00:50:30}

**Soofi Safavi:** And then the second thing is basically is is the counties. Everyone knows what the counties are, right? So in that case it's basically you want to get any data you just need to know what county you want and just basically you get that

**Mykyta Ovsiienko:** What counts and what tables? Yeah, we we can do that. I just generally don't even remember why, but I don't like names as an interface.

**Soofi Safavi:** I know because many people They're 10\.

**Mykyta Ovsiienko:** Just equals into

**Soofi Safavi:** name as an interface is important. That's why the DNS exists. No, nobody remembers IP address. But everybody, how how do how do you know to go to a website?

**Mykyta Ovsiienko:** Yeah, because I remembered it domain name.

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** Yeah.

**Soofi Safavi:** But that because you know you know what's actually is the brand this this exactly for the same thing for the people that they want this data. they will know what what is it that they need, right?

**Mykyta Ovsiienko:** Mhm.

**Soofi Safavi:** They want the HOA data for the Lee County.

### **00:51:32**

**Soofi Safavi:** They want permit information for Palm Beach County. It's actually I think it's beautiful because that's exactly how the user thinks.

**Mykyta Ovsiienko:** Yeah. I'm not saying that it will not work. I can't I can't even explain why I don't like it. And at some point of time I stick it into my head that name as an interface is bad.

**Soofi Safavi:** No, no, no. It's actually that's the foundation of internet. If you read the Chris Dixon's book, it says the genius of internet is the DNS.

**Mykyta Ovsiienko:** Yes,

**Soofi Safavi:** If DNS didn't exist,

**Mykyta Ovsiienko:** it is.

**Soofi Safavi:** internet wouldn't work.

**Mykyta Ovsiienko:** Yeah. Correct.

**Soofi Safavi:** So the name it is as as an interface when you have human as the consumer I would do it I would do it this way is basically we just do get for the certification process to just be awareness it's not even a certification

**Mykyta Ovsiienko:** Mhm.

**Soofi Safavi:** process is put us just a little bit in in the in the loop in a sense of the oracle but I would use the IPNS as basically as the as the registry and we basically on the elephant to just say this is where you go and then we just put a page it's very simply you just these are the all the data is available and these are all the counties that they're available you want to get the data just say what county what is there that's the formula go and just basically write your query You just

### **00:53:17**

**Soofi Safavi:** just start traversing through this and then you get all the sides for the park files and then you just start bringing it because it's very very unnatural like imagine I go to open door and tell open door you want our data go to get just not

**Mykyta Ovsiienko:** It sounds

**Soofi Safavi:** a it's not a it's not place. But if we do that, we just put it even on our website that we put a link from that to just basically the inventory. Our website would be the first place. Just the list. This will become exactly the way that address thing was because I am asking everyone to basically to I'm asking the team to update the website to just say what's online right now. All they need to do is just basically create a tab just say list of counties, list of data groups. If it shows up, it turns it into green.

**Mykyta Ovsiienko:** for this website should try all names every time or it will just read from the G should try Oh,

**Soofi Safavi:** No,

**Mykyta Ovsiienko:** I

### **00:54:39** {#00:54:39}

**Soofi Safavi:** it's basically it it what it that website it has the formula.

**Mykyta Ovsiienko:** Yeah, I need to just try it on me.

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** Okay.

**Soofi Safavi:** And the formula is it knows we know what's the list of the counties are and we know what's the list of our data groups are.

**Mykyta Ovsiienko:** Yeah. Yeah.

**Soofi Safavi:** And it's a border

**Mykyta Ovsiienko:** Yeah. Okay. and GitHub. What I like about GitHub is that we can put some automated validation at least

**Soofi Safavi:** get GitHub as a as a observability for us. I'm I'm in there. Um I think we should have that because that way we we create a little bit of a control in terms of you know we get a PR we get a request. So somebody has actually put the put put this data in before it's actually updated I need to I need to approve it and then what it does is basically GitHub when when you do the trigger and the trigger goes and just update the IPNS when you approve that and then we we know something happened and people they can't go you know update the IPNS based on based on whatever crap that they have Just it gives us but put us in the loop.

### **00:55:56** {#00:55:56}

**Mykyta Ovsiienko:** But in IPNS they can create with those names. They can create APNS name that will say county data group elephant data. they can follow this.

**Soofi Safavi:** But then why they do that? We don't do it.

**Mykyta Ovsiienko:** I'm saying we can do it but also they can do it. So what might happen is they took this name. No we want to pin certified data. We cannot because they already took this name. There is no like domain subdomain in IPNS.

**Soofi Safavi:** But isn't that actually the CI or the the top part that is being registered? It's the one that is pinned for us. But if you know that, you can update it. That's what you were saying.

**Mykyta Ovsiienko:** No, if we already own it, they cannot update. Oh,

**Soofi Safavi:** No, that's

**Mykyta Ovsiienko:** so what you're saying is that we'll have we will manage through the GitHub one APNS file that will list all of the and when you merge to GitHub then we publish to

**Soofi Safavi:** Yeah.

### **00:56:56** {#00:56:56}

**Mykyta Ovsiienko:** IPNS.

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** So if some someone wants to consume they will use IPNS then we manage if you want your data to show up there you you create a GitHub pull request once data is validated then we publish

**Soofi Safavi:** Yeah. Yeah. Yeah.

**Mykyta Ovsiienko:** it and then for website and everything else you you yeah then we don't need name as an interface we're just saying that remember this one APNS name and it will contain all the links

**Soofi Safavi:** Yeah. Exactly.

**Mykyta Ovsiienko:** yeah that works this way we preserve that All data that is available to consumers is valid and follow same lexicon.

**Soofi Safavi:** Yeah. Okay. So are we are we clear

**Mykyta Ovsiienko:** Yeah. One very important question is what do we do with existing data especially the ones that was mined is not in lexical format and all of that.

**Soofi Safavi:** them?

**Mykyta Ovsiienko:** Okay. We remine everything.

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** Okay.

**Soofi Safavi:** And what we want to what we want to remine right now is this 18,000 properties that they're from.

### **00:58:10** {#00:58:10}

**Soofi Safavi:** Uh they're in many Florida counties, but I want to remind that for basically for open door. That's that's what this triggered.

**Mykyta Ovsiienko:** Okay. Do you want to give me list of those? So I modify agent and immediately try it on those files.

**Soofi Safavi:** Yeah. Walking can do that.

**Joaquin Rodriguez:** Yeah, I can send it to you.

**Mykyta Ovsiienko:** Okay. And we are mining right now on local machines as I we are doing mining

**Soofi Safavi:** What's that?

**Mykyta Ovsiienko:** on local machines right now. Correct.

**Soofi Safavi:** They basically they uh did you see what Sean did? Sean created something that it's basically allows to put it on on on AWS too if you want but for for their own. So what I ask everybody to do is you want to do that I give you credit card just go create your own account.

**Mykyta Ovsiienko:** I didn't see it, but I assume it will be part of the agent that I will modify.

**Soofi Safavi:** Um who knows that's that's the that's the issue that I have like I have I have no idea.

### **00:59:24** {#00:59:24}

**Soofi Safavi:** It's just like I assume so. But like we'll you'll see.

**Mykyta Ovsiienko:** Yeah. Okay. Yeah, I just wanted to also test local mining to like prove to myself that it is super accessible

**Soofi Safavi:** Yeah. And then

**Mykyta Ovsiienko:** because I I remember that I put a lot of time to make sure agent allows for local mining. I remember that when we were doing MCP, one thing I cared is make sure that it is super crossplatform and is and you can deploy it to Azure, local, GCP or whatever.

**Soofi Safavi:** finish. Yeah. Okay. So now the other question is basically like is how how how hard it is to make these changes.

**Mykyta Ovsiienko:** Changes to the agent are always pretty trivial to do because it is markdown files. I need to check what happens in the MCP. What we need to modify there and then mine those 18,000

**Soofi Safavi:** But I just want to see when when you want to hand off to Joaquinbecause Joaquinis interfacing with open door.

### **01:00:30** {#01:00:30}

**Soofi Safavi:** So when when should expect to get something you can probably the 18,000 but I don't want that to be the end of the work. I want you to hand off this to him when you're done and then he redo the 18,000.

**Mykyta Ovsiienko:** Mhm.

**Soofi Safavi:** So this way he understand the whole thing and then he'll send that. So he needs to have a date and time from you to just say go try it at this point.

**Mykyta Ovsiienko:** Let's have a hand off to today, I guess. We don't have other time. So I will be wait let me give me one second because I have in calendar Eastern time. Let me Okay, let me change it to San Francisco. You are in San Francisco right now. Correct.

**Soofi Safavi:** Yeah.

**Mykyta Ovsiienko:** So it will be here. Let's do 11 a.m.

**Soofi Safavi:** Um, our time.

**Mykyta Ovsiienko:** Yeah. Yeah.

**Soofi Safavi:** That's fine. Are you good with that Joaquin?while you fall asleep. Why can you mute?

### **01:01:51**

**Soofi Safavi:** You're snoring. Yeah, it's like Okay, that's fine. 11 should be fine. Let's uh make sure that

**Mykyta Ovsiienko:** Okay. You want me to add you to this call as well?

**Soofi Safavi:** Oh. There are two of you, dude.

**Joaquin Rodriguez:** No. Um, no, it's cuz my computer froze. Uh,

**Soofi Safavi:** All right,

**Joaquin Rodriguez:** I'm good with 11\.

**Soofi Safavi:** that's fine. So, 11 uh the handoff will be 11:00 a.m. our time.

**Mykyta Ovsiienko:** Yeah.

**Joaquin Rodriguez:** Okay.

**Soofi Safavi:** Do you want to do you want to put that on the calendar? Just Okay,

**Mykyta Ovsiienko:** I just did.

**Soofi Safavi:** perfect. Yeah, just put me there. I'll join as well. Okay.

**Mykyta Ovsiienko:** Okay.

**Soofi Safavi:** And then

**Mykyta Ovsiienko:** And send me I don't know. Did we fix recordings? I really want this recording to then review myself.

**Soofi Safavi:** I I still don't can can you tell me like isn't that Google if you are on the call you you have access to it.

### **01:02:52** {#01:02:52}

**Mykyta Ovsiienko:** No, not always. We have because we had Where was that? board. We had yours when we set this up back in February, but when I go there, it has only till August 25\.

**Soofi Safavi:** I know but this I think this is not the this this exposes everything I initiate which from a from it That's not correct in

**Mykyta Ovsiienko:** Yeah, correct.

**Soofi Safavi:** a sense that like I don't want if I have a one-on-one with you to just basically get everybody else this didn't I I don't mind like but some of you guys but I don't want to open it up to everyone that they have that it's just that's not that's not the but that that's I don't understand is like but by design Google if you are you are on the actually on the invite list you would get an email that This is the recording and you have access to it

**Mykyta Ovsiienko:** Yeah, if wait let me check. If you're on invite list, yes. Yeah, you're correct.

**Soofi Safavi:** which

**Mykyta Ovsiienko:** We where we have issues when we create those in chat slashme or hard then I don't have access to it which this one is from

### **01:04:13**

**Soofi Safavi:** but even those it's actually it are you sure

**Mykyta Ovsiienko:** with those especially those slashmeat. Yeah, it doesn't send them.

**Soofi Safavi:** okay so I think we need to solve that. It sends it to who created it.

**Mykyta Ovsiienko:** Yeah, the whole created. Yes, maybe we just shouldn't do meet and everything called to calendar. This way it will be solved.

**Soofi Safavi:** I know it's like that's like it's annoying.

**Mykyta Ovsiienko:** It is,

**Soofi Safavi:** Yeah,

**Mykyta Ovsiienko:** but it work.

**Soofi Safavi:** you got to remember now and just go put it and just it's it's there. Okay. But this one you would have it. let let me figure out what is the what is the solution because I think it's a it's a little bit of a hack but that one you should be fine I'll pick me if it doesn't and then I'll just

**Mykyta Ovsiienko:** Yeah.

**Soofi Safavi:** actually specifically send that and it will solve that good

**Mykyta Ovsiienko:** Okay. Yeah.

**Soofi Safavi:** Joaquinyou're Okay.

**Joaquin Rodriguez:** Yes. All good.

### **01:05:18**

**Soofi Safavi:** Are you in bed?

**Joaquin Rodriguez:** Yeah.

**Soofi Safavi:** Yeah. In your underwear? I don't want to imagine that. So like that's my kid is the only one that is

**Joaquin Rodriguez:** You said it.

**Soofi Safavi:** actually if he's working he's sitting there like he and that's why he's the only one that is has his camera on all the time.

**Joaquin Rodriguez:** Mhm. Yeah.

**Soofi Safavi:** Yeah. So he he does not he does not work anywhere but that seat.

**Mykyta Ovsiienko:** No,

**Soofi Safavi:** So

**Mykyta Ovsiienko:** I I again unfortunately I can especially if I wait for agent. You see I have a back here.

**Joaquin Rodriguez:** Oops.

**Soofi Safavi:** yeah.

**Mykyta Ovsiienko:** That is the reason why I fall asleep sometimes.

**Soofi Safavi:** Yeah. Just like

**Mykyta Ovsiienko:** like let me just wait for the agent to finish for a few minutes and then Yeah.

**Soofi Safavi:** But I'm the I'm the opposite. I am working anyway. Like I'm walking in the car. It's just basically like I'm I'm the opposite of him.

### **01:06:09**

**Soofi Safavi:** So that's why I'm just when I'm not on camera

**Mykyta Ovsiienko:** Maybe it's because you have because your car drives itself.

**Soofi Safavi:** now. Now I do.

**Mykyta Ovsiienko:** Mine unfortunately doesn't

**Soofi Safavi:** But yeah, but I have I have a car that drive itself. I have a car that is stick shift which the opposite of that.

**Mykyta Ovsiienko:** mean manual gear.

**Soofi Safavi:** So you just Yeah.

**Mykyta Ovsiienko:** Uh,

**Soofi Safavi:** So it depends. It's the opposite. Like I don't even I can't even hold the hold the phone.

**Mykyta Ovsiienko:** why do you have manual gear? Like you you like to race or Oh,

**Soofi Safavi:** Yeah. It's a race car. It's it's a track car.

**Mykyta Ovsiienko:** okay.

**Soofi Safavi:** Yeah. It's um that is that is for the purpose of that. It's just not not not for anything.

**Mykyta Ovsiienko:** Yeah, then you shouldn't work when you're on the racetrack.

**Soofi Safavi:** No,

**Mykyta Ovsiienko:** You

**Soofi Safavi:** but sometimes I take it to the It's not only for the racetrack. It's a track car.

### **01:07:00**

**Soofi Safavi:** You can take it on the street. It's not a Formula One car. You know, Formula One cars, they don't have stick s\*\*\*. It's like a It's It's like Yeah,

**Mykyta Ovsiienko:** But but they still need to manage it manually.

**Soofi Safavi:** they have a clutch if that's what you're uh So,

**Mykyta Ovsiienko:** Yeah. Yeah.

**Soofi Safavi:** it's But it's not a It's not a stick. It's a It's a tap thing with a clutch, which I don't know how it works to be honest.

**Mykyta Ovsiienko:** But that is hard. On when I was on vacation, we had those like cockpits and Formula 1 game and I tried to queue up where you need to shift gears manually. That is hard as f\*\*\*. You need to manage speed. You need to see where the turn is. You need also it is like eight gears. You're on a turn, you need to kick to the third and check back.

**Soofi Safavi:** Yeah. Yeah. But they don't have a clutch, do they?

### **01:07:48**

**Soofi Safavi:** So you have only the gas and brake,

**Mykyta Ovsiienko:** No. Yeah. Yeah.

**Soofi Safavi:** but you need to you need to be because the the problem is what it does with the clutch is basically release the engagement. So you can put it in any gear, but those things if you all of a sudden go too fast, too low, you you you flip because imagine you your gear is in an end speed and then it just trigger with something that is smaller. So like the whole thing blows up. So you're absolutely right that it needs to be managed. But clutch makes it easier because it's forgiving. You just say disengage and then put it back in.

**Mykyta Ovsiienko:** Mhm.

**Soofi Safavi:** So but I now I'm realizing Formula 1 ones don't have a clutch because it's only only gas and

**Mykyta Ovsiienko:** Yeah.

**Soofi Safavi:** uh and uh brake.

**Mykyta Ovsiienko:** Also three paddles will be they have only two feet.

**Soofi Safavi:** But but the stick ship is actually is but they don't do the in in I don't think they use the left on the bridge.

**Mykyta Ovsiienko:** I think they do because even on cars you have gas on right pedal and brake on left pedal. Also because in Formula 1 every millisecond matters.

**Soofi Safavi:** Yeah, you're right.

**Mykyta Ovsiienko:** You cannot afford to switch your your foot to other pedal.

**Soofi Safavi:** It's just Yeah. Yeah. But in uh in automatic cars, we just don't we use only rights.

**Mykyta Ovsiienko:** Yeah, it just so that you don't blow up your car yourself because it is not

**Joaquin Rodriguez:** All

**Mykyta Ovsiienko:** for

**Soofi Safavi:** Okay, good stuff. Okay, thanks guys.

**Joaquin Rodriguez:** right,

**Mykyta Ovsiienko:** Thank you and have a good night.

**Joaquin Rodriguez:** that's

**Soofi Safavi:** Appreciate it. Thank you.

### **Transcription ended after 01:09:28**

*This editable transcript was computer generated and might contain errors. People can also change the text after it was created.*