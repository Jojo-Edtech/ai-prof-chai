import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusProfile, PublicationRecord } from "../src/shared/types";

type RouteHint = {
  label: string;
  url: string;
};

type ManualHint = {
  routes: RouteHint[];
  note: string;
};

type DownloadPlan = {
  priority: string;
  actionGroup: string;
  nextStep: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = path.join(projectRoot, "data", "processed", "chai-publications.json");
const processedDir = path.join(projectRoot, "data", "processed");
const outputsDir = path.join(projectRoot, "outputs");

const manualHints: Record<string, ManualHint> = {
  "10.1177/21582440241242188": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1177/21582440241242188" },
      { label: "SAGE PDF", url: "https://journals.sagepub.com/doi/pdf/10.1177/21582440241242188" },
      { label: "CUHK Pure", url: "https://research.cuhk.edu.hk/en/publications/development-and-validation-of-the-artificial-intelligence-learnin-2/" },
      { label: "CUHK published PDF", url: "https://research.cuhk.edu.hk/files/256092508/chai-et-al-2024-development-and-validation-of-the-artificial-intelligence-learning-intention-scale-%28ailis%29-for.pdf" },
      { label: "ResearchGate/SAGE PDF", url: "https://www.researchgate.net/journal/SAGE-Open-2158-2440/publication/379755697_Development_and_Validation_of_the_Artificial_Intelligence_Learning_Intention_Scale_AILIS_for_University_Students/links/661898d439e7641c0bad13a9/Development-and-Validation-of-the-Artificial-Intelligence-Learning-Intention-Scale-AILIS-for-University-Students.pdf" },
      { label: "RePEc/IDEAS full-text record", url: "https://ideas.repec.org/a/sae/sagope/v14y2024i2p21582440241242188.html" },
      { label: "LibKey route", url: "https://libkey.io/10.1177/21582440241242188?utm_source=ideas" }
    ],
    note: "SAGE PDF is publicly indexed as application/pdf; CUHK Pure lists a CC BY published version and exposes citation_pdf_url plus a document link; RePEc/IDEAS marks publisher full text with no download restriction; ResearchGate exposes the exact 16-page SAGE PDF. Local command-line and in-app browser requests still hit 403/Cloudflare/security checks. The CUHK Pure extractor found the same file candidate, but the file route returned HTTP 403 rather than PDF bytes, so use a normal browser or library route."
  },
  "10.1109/ISET49818.2020.00040": {
    routes: [
	      { label: "DOI", url: "https://doi.org/10.1109/ISET49818.2020.00040" },
	      { label: "IEEE Xplore", url: "https://ieeexplore.ieee.org/document/9215506" },
	      { label: "IEEE direct PDF", url: "https://ieeexplore.ieee.org/iel7/9210708/9215461/09215506.pdf" },
	      { label: "CUHK record", url: "https://research.cuhk.edu.hk/en/publications/factors-influencing-students-behavioral-intention-to-continue-art-2/" },
	      {
	        label: "ResearchGate record",
	        url: "https://www.researchgate.net/publication/347153393_Factors_Influencing_Students%27_Behavioral_Intention_to_Continue_Artificial_Intelligence_Learning"
	      }
	    ],
	    note: "IEEE route appears closed or institution-gated. Crossref exposes an IEEE staging PDF-like URL, but local request returned HTML, not PDF. In-app browser access to the direct PDF route resolved to the IEEE Xplore article page with a PDF control and Institutional Sign In, not a file download. ResearchGate confirms the exact DOI/title/authors but marks no full text available."
	  },
  "10.1504/IJMLO.2020.106181": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1504/IJMLO.2020.106181" },
      { label: "Inderscience PDF", url: "https://www.inderscienceonline.com/doi/pdf/10.1504/IJMLO.2020.106181" },
      { label: "CUHK metadata", url: "https://research.cuhk.edu.hk/en/publications/surveying-chinese-teachers-technological-pedagogical-stem-knowled-2/" },
      { label: "ResearchGate record", url: "https://www.researchgate.net/publication/340407252_Surveying_Chinese_teachers%27_technological_pedagogical_STEM_knowledge_a_pilot_validation_of_STEM-TPACK_survey" }
    ],
    note: "Inderscience PDF is indexed, but local direct request and in-app browser checks returned a Cloudflare/security page; CUHK Pure confirms exact metadata but exposes no PDF candidate; ResearchGate is request-only/no full text. Use browser or institution access."
  },
  "10.1080/03055698.2019.1627662": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1080/03055698.2019.1627662" },
      { label: "Taylor & Francis PDF", url: "https://www.tandfonline.com/doi/pdf/10.1080/03055698.2019.1627662" },
      { label: "ResearchGate record", url: "https://www.researchgate.net/publication/333705453_Surveying_and_modelling_China_high_school_students%27_experience_of_and_preferences_for_twenty-first-century_learning_and_their_academic_and_knowledge_creation_efficacy" }
    ],
    note: "Taylor & Francis is the verified publisher PDF route; ResearchGate is request-only. The public CUHK 389282960.pdf search hit is a different 2022 medical-students paper and is intentionally excluded."
  },
  "10.1177/0735633117752453": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1177/0735633117752453" },
      { label: "SAGE PDF", url: "https://journals.sagepub.com/doi/pdf/10.1177/0735633117752453" },
      { label: "ERIC metadata", url: "https://eric.ed.gov/?id=EJ1209476" },
      { label: "ResearchGate record", url: "https://www.researchgate.net/publication/322811953_Enhancing_and_Modeling_Teachers%27_Design_Beliefs_and_Efficacy_of_Technological_Pedagogical_Content_Knowledge_for_21st_Century_Quality_Learning" }
    ],
    note: "Crossref exposes a SAGE text-mining PDF route, but local request returned 403/security page. ERIC confirms metadata but no ERIC full-text PDF; ResearchGate is request-only/no full text."
  },
  "10.1016/j.compedu.2011.01.007": {
    routes: [
	      { label: "DOI", url: "https://doi.org/10.1016/j.compedu.2011.01.007" },
	      { label: "ScienceDirect", url: "https://www.sciencedirect.com/science/article/pii/S0360131511000157" },
	      { label: "Elsevier text-mining API", url: "https://api.elsevier.com/content/article/PII:S0360131511000157?httpAccept=text/plain" },
	      { label: "LearnTechLib record", url: "https://www.learntechlib.org/p/50742" },
	      { label: "Academia full-text record", url: "https://www.academia.edu/1609052/Modeling_primary_school_pre_service_teachers_Technological_Pedagogical_Content_Knowledge_TPACK_for_meaningful_learning_with_information_and_communication_technology_ICT_" },
	      {
	        label: "ResearchGate record",
	        url: "https://www.researchgate.net/publication/220140854_Modeling_primary_school_pre-service_teachers%27_Technological_Pedagogical_Content_Knowledge_TPACK_for_meaningful_learning_with_information_and_communication_technology_ICT"
	      }
	    ],
	    note: "Crossref confirms the correct Elsevier PII is S0360131511000157. Academia displays the exact article text and a Download Free PDF control in browser-visible results, but the in-app browser click did not trigger a file download and the page prompted sign-up access. LearnTechLib has a matching metadata record but local direct access returns 403/verification. ScienceDirect and Elsevier text-mining API routes reached Cloudflare/403 or closed access locally. ResearchGate confirms the exact DOI/title/authors but is a metadata/request route, not a verified PDF."
	  },
  "10.1504/IJCEELL.2011.039690": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1504/IJCEELL.2011.039690" },
      { label: "ResearchGate PDF", url: "https://www.researchgate.net/profile/Ching-Chai/publication/264816872_Towards_a_new_era_of_knowledge_creation_A_brief_discussion_of_the_epistemology_for_knowledge/links/540d039d0cf2d8daaacaee39/Towards-a-new-era-of-knowledge-creation-A-brief-discussion-of-the-epistemology-for-knowledge.pdf" },
      { label: "Inderscience PDF", url: "https://www.inderscienceonline.com/doi/pdf/10.1504/IJCEELL.2011.039690" }
    ],
    note: "ResearchGate exposes Article PDF Available/Public Full-text 1 and the exact 21-page application/pdf with matching title/DOI/authors. A 2026-07-08 external web inspection could view the exact PDF page, but the project machine retry of the same URL returned HTTP 403 HTML rather than %PDF- bytes, so it is not saved or counted. Inderscience is the publisher PDF route and remains available for institution access."
  },
  "10.1504/IJCEELL.2011.039691": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1504/IJCEELL.2011.039691" },
      { label: "ResearchGate PDF", url: "https://www.researchgate.net/profile/Ching-Chai/publication/264816958_Two_exploratory_studies_of_the_relationships_between_teachers%27_epistemic_beliefs_and_their_online_interactions/links/5525c90a0cf24b822b405c07/Two-exploratory-studies-of-the-relationships-between-teachers-epistemic-beliefs-and-their-online-interactions.pdf" },
      { label: "Inderscience PDF", url: "https://www.inderscienceonline.com/doi/pdf/10.1504/IJCEELL.2011.039691" }
    ],
    note: "ResearchGate exposes the exact 12-page application/pdf target with matching title, authors, and DOI. A 2026-07-08 external web inspection could view the exact PDF page, but the project machine retry of the same URL returned HTTP 403 HTML rather than %PDF- bytes, so it is not saved or counted. The IKIT 06-Chai.pdf file remains only a related 2010 single-study version and is kept out of the target route."
  },
  "10.1080/13664530.2011.635266": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1080/13664530.2011.635266" },
      { label: "Taylor & Francis PDF", url: "https://www.tandfonline.com/doi/pdf/10.1080/13664530.2011.635266" },
      { label: "Murdoch metadata", url: "https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/Singaporean-pre-service-teachers-beliefs-about-epistemology/991005540694507891" },
      { label: "Murdoch repository record", url: "https://researchrepository.murdoch.edu.au/id/eprint/48549/" },
      { label: "Auckland handle", url: "https://hdl.handle.net/2292/10449" },
      { label: "CUHK metadata", url: "https://research.cuhk.edu.hk/en/publications/singaporean-pre-service-teachers-beliefs-about-epistemology-teach-2/" },
      { label: "ERIC metadata", url: "https://eric.ed.gov/?id=EJ949942" },
      { label: "LearnTechLib issue record", url: "https://www.learntechlib.org/j/ISSN-1366-4530/v/15/n/4" },
      { label: "ResearchGate record", url: "https://www.researchgate.net/publication/241745900_Singaporean_pre-service_teachers%27_beliefs_about_epistemology_teaching_and_learning_and_technology" }
    ],
    note: "Taylor & Francis route appears closed. Murdoch Esploro public fullAssetPage API returned 200 for mmsID 991005540694507891, but openAccessIndicator is No, filesMetadata is empty, and viewer/representationInfo exposes no file/link fields. Auckland/CUHK/ERIC/LearnTechLib confirm metadata or issue routes but expose no public PDF bytes in local checks; LearnTechLib local direct access returns 403/verification; ResearchGate exposes request-full-text only."
  },
  "10.1080/13598660903250381": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1080/13598660903250381" },
	      { label: "Auckland handle", url: "https://hdl.handle.net/2292/10470" },
	      { label: "Auckland bitstream", url: "https://researchspace.auckland.ac.nz/bitstreams/08d672c4-9e91-417b-b34a-ab570fa21b21/download" },
	      { label: "Murdoch metadata", url: "https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/The-change-in-epistemological-beliefs-and/991005541241107891" },
	      { label: "Murdoch repository record", url: "https://researchrepository.murdoch.edu.au/id/eprint/48726/" },
	      { label: "Taylor & Francis PDF", url: "https://www.tandfonline.com/doi/pdf/10.1080/13598660903250381" },
	      {
	        label: "ResearchGate request page",
	        url: "https://www.researchgate.net/publication/232998347_The_change_in_epistemological_beliefs_and_beliefs_about_teaching_and_learning_A_study_among_pre-service_teachers"
	      }
	    ],
	    note: "Auckland handle confirms the exact title, DOI, authors, and Taylor & Francis copyright, but the visible page exposes no public PDF link. The ResearchSpace API lists only a TEXT bundle; the bitstream content returns 401 when unauthenticated. Taylor & Francis PDF route reached Cloudflare or Get Access in browser checks. Murdoch Esploro public fullAssetPage API returned 200 for mmsID 991005541241107891, but openAccessIndicator is No, filesMetadata is empty, and viewer/representationInfo exposes no file/link fields. ResearchGate confirms the exact DOI/title/authors and exposes request-full-text, not a verified public PDF. Use institution/library access or document delivery."
	  },
  "10.1177/016146810911100503": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1177/016146810911100503" },
      { label: "SAGE article", url: "https://journals.sagepub.com/doi/10.1177/016146810911100503" },
      { label: "SAGE PDF", url: "https://journals.sagepub.com/doi/pdf/10.1177/016146810911100503" },
      { label: "ERIC record", url: "https://eric.ed.gov/?id=EJ842198" },
      { label: "LearnTechLib record", url: "https://www.learntechlib.org/p/106062" },
      { label: "ResearchGate request page", url: "https://www.researchgate.net/publication/279602232_Professional_Development_of_Teachers_for_Computer-Supported_Collaborative_Learning_A_Knowledge-Building_Approach" }
    ],
    note: "SAGE confirms the article and DOI; the SAGE PDF URL redirects to restricted access unless authenticated. ERIC and LearnTechLib are metadata-only or access-limited; ResearchGate exposes request-full-text, not a verified PDF. An OpenAlex/IDEALS PDF candidate was rejected because DOI, author, and year did not match this target."
  },
  "WOS:000269712100005": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1177/016146810911100503" },
      { label: "SAGE article", url: "https://journals.sagepub.com/doi/10.1177/016146810911100503" },
      { label: "SAGE PDF", url: "https://journals.sagepub.com/doi/pdf/10.1177/016146810911100503" },
      { label: "ERIC record", url: "https://eric.ed.gov/?id=EJ842198" },
      { label: "LearnTechLib record", url: "https://www.learntechlib.org/p/106062" },
      { label: "ResearchGate request page", url: "https://www.researchgate.net/publication/279602232_Professional_Development_of_Teachers_for_Computer-Supported_Collaborative_Learning_A_Knowledge-Building_Approach" }
    ],
    note: "WoS export omitted the DOI. The known TCR/SAGE DOI route is correct; the SAGE PDF URL redirects to restricted access unless authenticated. ERIC and LearnTechLib confirm metadata only; ResearchGate is request-only. An OpenAlex/IDEALS PDF candidate was rejected because DOI, author, and year did not match this target."
  },
  "10.1080/13598660801971641": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1080/13598660801971641" },
      { label: "Taylor & Francis PDF", url: "https://www.tandfonline.com/doi/pdf/10.1080/13598660801971641" },
      { label: "Murdoch metadata", url: "https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/Beliefs-about-teaching-and-uses-of/991005542585407891" },
      { label: "Murdoch repository record", url: "https://researchrepository.murdoch.edu.au/id/eprint/48733/" },
      { label: "Auckland handle", url: "https://hdl.handle.net/2292/10373" },
      { label: "CUHK metadata", url: "https://research.cuhk.edu.hk/en/publications/beliefs-about-teaching-and-uses-of-technology-among-pre-service-t-2/" },
      { label: "Academia record", url: "https://www.academia.edu/1863878/Beliefs_about_teaching_and_uses_of_technology_among_pre_service_teachers" },
      { label: "LearnTechLib record", url: "https://www.learntechlib.org/p/68543/" },
      { label: "ResearchGate PDF", url: "https://www.researchgate.net/profile/Timothy-Teo/publication/232893563_Beliefs_about_teaching_and_uses_of_technology_among_pre-service_teachers/links/02e7e528a65aabf885000000/Beliefs-about-teaching-and-uses-of-technology-among-pre-service-teachers.pdf" },
      { label: "ResearchGate record", url: "https://www.researchgate.net/publication/232893563_Beliefs_about_teaching_and_uses_of_technology_among_pre-service_teachers" }
    ],
    note: "ResearchGate exposes Public Full-text 1 and the exact 13-page application/pdf with matching title/DOI/authors. A 2026-07-08 external web inspection could view the exact PDF page, but the project machine retry of the same URL returned HTTP 403 HTML rather than %PDF- bytes, so it is not saved or counted. CUHK, Academia, and LearnTechLib have exact title records for browser checking; the Taylor & Francis PDF route resolved to a Get Access page in browser checks. Murdoch Esploro public fullAssetPage API returned 200 for mmsID 991005542585407891, but openAccessIndicator is No, filesMetadata is empty, and viewer/representationInfo exposes no file/link fields. Auckland/CUHK/LearnTechLib confirm metadata or handle routes but expose no public PDF bytes."
  },
  "10.1080/09523980600926242": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1080/09523980600926242" },
      { label: "Taylor & Francis PDF", url: "https://www.tandfonline.com/doi/pdf/10.1080/09523980600926242" },
      { label: "Murdoch metadata", url: "https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/Epistemological-beliefs-on-teaching-and-learning/991005540351307891" },
      { label: "Murdoch repository record", url: "https://researchrepository.murdoch.edu.au/id/eprint/53949/" },
      { label: "Auckland handle", url: "https://hdl.handle.net/2292/10377" },
      { label: "CUHK metadata", url: "https://research.cuhk.edu.hk/en/publications/epistemological-beliefs-on-teaching-and-learning-a-survey-among-p-2/" },
      { label: "Academia record", url: "https://www.academia.edu/4375474/Epistemological_beliefs_on_teaching_and_learning_a_survey_among_pre_service_teachers_in_Singapore" },
      { label: "LearnTechLib record", url: "https://www.learntechlib.org/p/166451" },
      { label: "ResearchGate PDF", url: "https://www.researchgate.net/profile/Myint-Khine/publication/240531274_Epistemological_beliefs_on_teaching_and_learning_A_survey_among_pre-service_teachers_in_Singapore/links/00b4952b66bf64a810000000/Epistemological-beliefs-on-teaching-and-learning-A-survey-among-pre-service-teachers-in-Singapore.pdf" },
      { label: "ResearchGate record", url: "https://www.researchgate.net/publication/240531274_Epistemological_beliefs_on_teaching_and_learning_A_survey_among_pre-service_teachers_in_Singapore" }
    ],
    note: "ResearchGate exposes Article PDF Available/Public Full-text 1 and the exact 14-page application/pdf with matching title/DOI/authors. A 2026-07-08 external web inspection could view the exact PDF page, but the project machine retry of the same URL returned HTTP 403 HTML rather than %PDF- bytes, so it is not saved or counted. Academia, CUHK, and LearnTechLib provide exact title metadata routes for browser checking; the Taylor & Francis PDF route resolved to a Get Access page in browser checks. Murdoch Esploro public fullAssetPage API returned 200 for mmsID 991005540351307891, but openAccessIndicator is No, filesMetadata is empty, and viewer/representationInfo exposes no file/link fields. Auckland/LearnTechLib confirm metadata or handle routes but expose no public PDF bytes."
  },
  "10.1142/9789812774651_0024": {
    routes: [
      { label: "DOI", url: "https://doi.org/10.1142/9789812774651_0024" },
      { label: "World Scientific chapter", url: "https://www.worldscientific.com/doi/10.1142/9789812774651_0024" },
      { label: "World Scientific full route", url: "https://www.worldscientific.com/doi/full/10.1142/9789812774651_0024" },
      { label: "World Scientific PDF", url: "https://www.worldscientific.com/doi/pdf/10.1142/9789812774651_0024" },
      { label: "World Scientific book page", url: "https://www.worldscientific.com/worldscibooks/10.1142/5946" },
      { label: "ResearchGate record", url: "https://www.researchgate.net/publication/279723916_Computer-supported_collaborative_learning_for_knowledge_creation" }
    ],
    note: "World Scientific chapter, full, PDF, and book routes confirm the publisher landing pages but return 403/closed-access HTML in local checks, not PDF bytes; in-app browser PDF access also reached a Cloudflare/security page. ResearchGate confirms the chapter metadata but exposes request-full-text only."
  },
  "WOS:000273518800088": {
    routes: [
      { label: "DBLP record", url: "https://dblp.org/rec/conf/icce/ChaiT07" },
      { label: "ACM proceeding record", url: "https://dl.acm.org/doi/10.5555/1565478.1565590" },
      { label: "IOS Press article metadata", url: "https://ebooks.iospress.nl/volumearticle/3865" },
      { label: "IOS Press volume page", url: "https://ebooks.iospress.nl/volume/supporting-learning-flow-through-integrative-technologies" },
      { label: "Title search", url: "https://dblp.org/search?q=Teachers%27%20EB%20and%20its%20Influences%20on%20their%20Online%20Interaction%20Patterns" }
    ],
    note: "No DOI in WoS export. DBLP and ACM confirm bibliographic metadata. IOS Press article id 3865 confirms the exact title, authors, and pages 603-606 in Volume 162, but the article page has no Download PDF action and the public /Download/Pdf endpoint returns NotFound/HTML for id 3865. Nearby open-access ISLS links on DBLP author pages belong to adjacent records and must not be used as this target PDF."
  }
};

const downloadPlans: Record<string, DownloadPlan> = {
  "10.1177/21582440241242188": {
    priority: "1 Browser OA",
    actionGroup: "Open-access browser save",
    nextStep: "Use a normal browser first: open SAGE PDF, then CUHK published PDF if SAGE blocks automation."
  },
  "10.1109/ISET49818.2020.00040": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Open IEEE Xplore after institution login; use the page Download PDF button if the direct PDF URL returns HTML."
  },
  "10.1504/IJMLO.2020.106181": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Try Inderscience PDF through institution access; use ResearchGate only as a title/author check."
  },
  "10.1080/03055698.2019.1627662": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Open Taylor & Francis PDF after institution login; use DOI page if the PDF route redirects."
  },
  "10.1177/0735633117752453": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Open SAGE PDF in browser; if it asks for access, use institution login before trying ResearchGate."
  },
  "10.1016/j.compedu.2011.01.007": {
    priority: "2 Repository/browser",
    actionGroup: "Repository browser save",
    nextStep: "Try the Academia full-text record in a normal browser first; use ScienceDirect through institution access if the Academia download challenges."
  },
  "10.1504/IJCEELL.2011.039690": {
    priority: "2 Author upload",
    actionGroup: "Author-upload browser save",
    nextStep: "Try the ResearchGate PDF in a normal browser first; if blocked, use Inderscience through institution access."
  },
  "10.1504/IJCEELL.2011.039691": {
    priority: "2 Author upload",
    actionGroup: "Author-upload browser save",
    nextStep: "Try the exact ResearchGate public PDF in a normal browser first; if blocked, use Inderscience through institution access. Do not use IKIT 06-Chai.pdf as the target article."
  },
  "10.1080/13664530.2011.635266": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Open Taylor & Francis PDF after institution login."
  },
  "10.1080/13598660903250381": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Use Taylor & Francis or Auckland/ResearchSpace through institution/library access; public Auckland page currently exposes metadata only."
  },
  "10.1177/016146810911100503": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Open the SAGE article page after institution login and use its PDF/download control."
  },
  "WOS:000269712100005": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Open the SAGE article page after institution login and use its PDF/download control."
  },
  "10.1080/13598660801971641": {
    priority: "2 Author upload",
    actionGroup: "Author-upload browser save",
    nextStep: "Try the ResearchGate public full-text PDF in a normal browser first; use Taylor & Francis through institution if needed."
  },
  "WOS:000273518800088": {
    priority: "4 Hard locate",
    actionGroup: "Library/document delivery",
    nextStep: "Use the title and WoS record for library/document-delivery lookup; no verified PDF route is available yet."
  },
  "10.1080/09523980600926242": {
    priority: "2 Author upload",
    actionGroup: "Author-upload browser save",
    nextStep: "Try the ResearchGate public full-text PDF in a normal browser first; use Taylor & Francis through institution if needed."
  },
  "10.1142/9789812774651_0024": {
    priority: "3 Institution route",
    actionGroup: "Institution/library access",
    nextStep: "Use World Scientific or library/document-delivery access for the book chapter PDF."
  }
};

function isTarget(record: PublicationRecord) {
  return record.isFirstAuthor || record.isCorrespondingAuthor;
}

function keyFor(record: PublicationRecord) {
  return record.doi || record.wosAccession || record.id;
}

function fallbackHint(record: PublicationRecord): ManualHint {
  return {
    routes: record.doiUrl ? [{ label: "DOI", url: record.doiUrl }] : [],
    note: "Manual browser or institution access needed."
  };
}

function planFor(record: PublicationRecord): DownloadPlan {
  return (
    downloadPlans[keyFor(record)] || {
      priority: "4 Hard locate",
      actionGroup: "Library/document delivery",
      nextStep: "Use the DOI/WoS metadata for library lookup or document delivery."
    }
  );
}

function isFastBrowserAction(actionGroup: string) {
  return /browser save/i.test(actionGroup);
}

function preferredFastRoute(actionGroup: string, routes: RouteHint[]) {
  if (/author-upload/i.test(actionGroup)) {
    return (
      routes.find((route) => /researchgate/i.test(route.label) && /pdf/i.test(route.label)) ||
      routes.find((route) => /researchgate/i.test(route.url) && /\.pdf/i.test(route.url)) ||
      routes.find((route) => /researchgate/i.test(route.label)) ||
      routes.find((route) => /researchgate/i.test(route.url))
    );
  }
  if (/repository/i.test(actionGroup)) {
    return (
      routes.find((route) => /handle|bitstream/i.test(route.label)) ||
      routes.find((route) => /hdl\.handle|bitstreams/i.test(route.url)) ||
      routes.find((route) => /academia/i.test(route.label) || /academia\.edu/i.test(route.url))
    );
  }
  if (/open-access/i.test(actionGroup)) {
    return routes.find((route) => /sage pdf|published pdf|cuhk/i.test(route.label));
  }
  return routes.find((route) => /pdf|published|handle/i.test(route.label)) || routes[0];
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function routeText(routes: RouteHint[]) {
  return routes.map((route) => `${route.label}: ${route.url}`).join(" | ");
}

function writeCsv(records: PublicationRecord[], outputPath: string) {
  const rows = [
    ["year", "title", "source", "doi", "wos_accession", "expected_pdf_file", "access_priority", "action_group", "next_step", "manual_routes", "note"],
    ...records.map((record) => {
      const hint = manualHints[keyFor(record)] || fallbackHint(record);
      const plan = planFor(record);
      return [
        record.year || "",
        record.title,
        record.source || "",
        record.doi || "",
        record.wosAccession || "",
        record.pdfFile || "",
        plan.priority,
        plan.actionGroup,
        plan.nextStep,
        routeText(hint.routes),
        hint.note
      ];
    })
  ];
  fs.writeFileSync(outputPath, `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`, "utf8");
}

function writeMarkdown(records: PublicationRecord[], profile: CorpusProfile, outputPath: string) {
  const lines = [
    "# Missing PDF Download Queue",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Target records: ${profile.summary.firstOrCorresponding}`,
    `Saved target PDFs: ${profile.summary.pdfSaved}`,
    `Missing target PDFs: ${records.length}`,
    "",
    "Use this queue for manual browser or institution downloads. After saving files, put the original PDFs in `data/pdf-inbox/`, then run:",
    "",
    "```bash",
    "npm run ingest:pdfs",
    "npm run index:pdfs",
    "npm run distill",
    "```",
    "",
    "If the files stay in the system Downloads folder, run `npm run ingest:downloads` instead of moving them into `data/pdf-inbox/`.",
    "",
    "## Fast Browser Saves",
    ""
  ];

  const fastRecords = records.filter((record) => isFastBrowserAction(planFor(record).actionGroup));
  if (fastRecords.length) {
    fastRecords.forEach((record, index) => {
      const hint = manualHints[keyFor(record)] || fallbackHint(record);
      const plan = planFor(record);
      const firstRoute = preferredFastRoute(plan.actionGroup, hint.routes) || hint.routes[0];
      lines.push(`${index + 1}. ${record.year || "n.d."} - ${record.title}`);
      lines.push(`   - Route type: ${plan.actionGroup}`);
      lines.push(`   - First link: ${firstRoute ? `[${firstRoute.label}](${firstRoute.url})` : "not available"}`);
      lines.push(`   - Expected file: \`${record.pdfFile || "not generated"}\``);
    });
  } else {
    lines.push("No fast browser-save items are currently available.");
  }

  lines.push(
    "",
    "## Queue",
    ""
  );

  records.forEach((record, index) => {
    const hint = manualHints[keyFor(record)] || fallbackHint(record);
    const plan = planFor(record);
    lines.push(`### ${index + 1}. ${record.title}`, "");
    lines.push(`- Year: ${record.year || "n.d."}`);
    lines.push(`- Source: ${record.source || "unknown"}`);
    lines.push(`- DOI: ${record.doi || "not available"}`);
    lines.push(`- WoS accession: ${record.wosAccession || "not available"}`);
    lines.push(`- Expected PDF filename: \`${record.pdfFile || "not generated"}\``);
    lines.push(`- Priority: ${plan.priority}`);
    lines.push(`- Action group: ${plan.actionGroup}`);
    lines.push(`- Next step: ${plan.nextStep}`);
    if (hint.routes.length) {
      lines.push("- Manual routes:");
      hint.routes.forEach((route) => lines.push(`  - [${route.label}](${route.url})`));
    } else {
      lines.push("- Manual routes: not available");
    }
    lines.push(`- Note: ${hint.note}`, "");
  });

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

if (!fs.existsSync(profilePath)) {
  throw new Error("Missing data/processed/chai-publications.json. Run npm run import:wos first.");
}

fs.mkdirSync(processedDir, { recursive: true });
fs.mkdirSync(outputsDir, { recursive: true });

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8")) as CorpusProfile;
const missing = profile.records.filter((record) => isTarget(record) && record.downloadStatus === "pdf-needed");
const csvPath = path.join(processedDir, "missing-pdf-queue.csv");
const markdownPath = path.join(outputsDir, "missing-pdf-download-queue.md");

writeCsv(missing, csvPath);
writeMarkdown(missing, profile, markdownPath);

console.log(`Missing target PDFs: ${missing.length}`);
console.log(markdownPath);
console.log(csvPath);
